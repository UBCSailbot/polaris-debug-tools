import sys
import multiprocessing
import time
import csv
import os
from datetime import datetime

from PyQt5.QtWidgets import (
    QApplication, QWidget, QLabel, QLineEdit, QPushButton, QVBoxLayout,
    QMessageBox, QTextEdit, QHBoxLayout, QCheckBox, QGridLayout, QScrollArea,
    QSizePolicy
)
from PyQt5.QtCore import QTimer, Qt
from PyQt5.QtGui import QPixmap
from matplotlib.backends.backend_qt5agg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.figure import Figure
from DataObject_V2 import *
from config import *

# SSH Credentials
hostname = "192.168.0.10"
username = "sailbot"
password = "sailbot"

can_line = "can0"

### ----------  Utility Functions ---------- ###
# Note that these functions are designed to work with positive numbers
def convert_to_hex(decimal, num_bytes):
    return format(decimal, "X").zfill(2 * num_bytes)

def convert_to_little_endian(hex_str):
    raw = bytes.fromhex(hex_str)
    return raw[::-1].hex()

def convert_from_little_endian_str(hex_str):
    raw = bytes.fromhex(hex_str)
    big_endian = raw[::-1].hex()
    return int(big_endian, 16)

### ---------- Creating UI Objects ---------- ###
# Used for creating QLabels for displaying current data values
def create_label(title, min_width=value_label_min_width, max_height=value_label_max_height):
    label = QLabel(title)
    label.setMinimumWidth(min_width)
    label.setMaximumHeight(max_height)
    label.setAlignment(Qt.AlignLeft)
    label.setStyleSheet(value_style)
    return label

def create_graph(title, ylabel, ymin, ymax):
    '''
    Used for creating graphs - does not create lines\n
    ymin : initial minimum graph y-value\n
    ymax : initial maximum graph y-value
    '''
    figure = Figure(figsize=(8, 4), tight_layout=True)
    canvas = FigureCanvas(figure)
    canvas.setMinimumSize(graph_min_width, graph_min_height)
    ax = figure.add_subplot(111)
    ax.set_title(title)
    ax.set_xlabel(graph_ylabel)
    ax.set_ylabel(ylabel)
    ax.set_xlim(0, 60) # Initial X range is 0-60 secs
    ax.set_ylim(ymin, ymax) # Initial ymin and ymax
    ax.grid(True, alpha=0.3)
    return (figure, canvas, ax)

### ----------  Parsing Data Frames  ---------- ###

def parse_0x206_frame(data_hex):
    raw_bytes = bytes.fromhex(data_hex)
    if len(raw_bytes) != 24:
        raise ValueError("Incorrect data length (num bytes): ID 0x206")

    val = lambda s, e, div: int.from_bytes(raw_bytes[s:e], 'little') / div
    return {
        volt2_obj.name: val(0, 2, 1000.0),
        temp1_obj.name: val(2, 4, 100.0),
        volt3_obj.name: val(4, 6, 1000.0),
        temp2_obj.name: val(6, 8, 100.0),
        temp3_obj.name: val(8, 10, 100.0),
        volt4_obj.name: val(10, 12, 1000.0),
        volt1_obj.name: val(12, 14, 1000.0),
        mppt_hp_obj.name: val(14, 16, 1000.0),
        mppt_hs_obj.name: val(16, 18, 1000.0),
        mppt_sp_obj.name: val(18, 20, 1000.0),
        mppt_ss_obj.name: val(20, 22, 1000.0)
    }

def parse_0x204_frame(data_hex):
    raw_bytes = bytes.fromhex(data_hex)
    if len(raw_bytes) != 16:
        raise ValueError("Incorrect data length (num bytes): ID 0x204")
    
    val = lambda s, e, div: int.from_bytes(raw_bytes[s:e], 'little') / div
    print(f"derivative_obj: {(val(12, 14, 1.0) - 300) / 100.0}")
    print(f"spd_over_gnd_obj: {val(14, 16, 100.0)}")
    return {
        actual_rudder_obj.name: val(0, 2, 100.0) - 90,
        imu_roll_obj.name: val(2, 4, 100.0) - 180,
        imu_pitch_obj.name: val(4, 6, 100.0) - 180,
        imu_heading_obj.name: val(6, 8, 100.0),
        set_rudder_obj.name: val(8, 10, 100.0) - 90,
        integral_obj.name: val(10, 12, 1.0) - 30000,
        derivative_obj.name: (val(12, 14, 1.0) - 300) / 100.0,
        spd_over_gnd_obj.name: val(14, 16, 1000.0)
    }
    

def actual_rudder_parsing_fn(parsed_dict):
    return parsed_dict[actual_rudder_obj.name]

def set_rudder_parsing_fn(parsed_dict):
    return parsed_dict[set_rudder_obj.name]

def parse_0x041_frame(data_hex):
    raw_bytes = bytes.fromhex(data_hex)
    if len(raw_bytes) != 4:
        raise ValueError("Incorrect data length (num bytes): ID 0x041")
    
    val = lambda s, e, div: int.from_bytes(raw_bytes[s:e], 'little') / div
    return {
        data_wind_dir_obj.name: val(0, 2, 1.0),
        data_wind_spd_obj.name: val(2, 4, 10.0)
    }

# Salinity data frame
def parse_0x12X_frame(data_hex):
    raw_bytes = bytes.fromhex(data_hex)
    if len(raw_bytes) != 4:
        raise ValueError("Incorrect data length (num bytes): ID 0x12X")
    
    # Conductivity in µS/cm * 1000
    # raw = int.from_bytes(raw_bytes, "little") # is raw_bytes[0:2] really necessary?
    raw = convert_from_little_endian_str(data_hex)
    actual = raw / (1000)

    if (actual < 1 and actual != 0 or actual > 550000):
        print(f"[ERROR]: sal data parsed as {actual}")    
        print(f"data_hex = {data_hex}")
        print(f"raw = {raw}")
        raise ValueError()
    
    if (actual < 100): actual = round(actual, 2)
    elif (actual < 1000): actual = round(actual, 1)
    elif (actual < 10000): actual = round(actual)
    elif (actual < 100000): actual = round(actual, -1)
    return {"sal": actual} 

# Salinity parsing function
def sal_parsing_fn(data_hex):
    '''
    Parses data for salinity 0x12X frame\n
    In particular, this function also calculates rounding since 
    accurate rounding depends on the magnitude of the value recorded
    '''
    raw_bytes = bytes.fromhex(data_hex)
    if len(raw_bytes) != 4:
        raise ValueError("Incorrect data length (num bytes): ID 0x12X")
    
    # Conductivity in µS/cm * 1000
    raw = convert_from_little_endian_str(data_hex)
    actual = raw / (1000)

    if (actual < 1 and actual != 0 or actual > 550000):
        print(f"[ERROR]: sal data parsed as {actual}")    
        print(f"data_hex = {data_hex}")
        print(f"raw = {raw}")
        raise ValueError()
    
    if (actual < 100): actual = round(actual, 2)
    elif (actual < 1000): actual = round(actual, 1)
    elif (actual < 10000): actual = round(actual)
    elif (actual < 100000): actual = round(actual, -1)
    return actual

# pH data frame
def parse_0x11X_frame(data_hex):
    raw_bytes = bytes.fromhex(data_hex)
    if len(raw_bytes) != 2:
        raise ValueError(f"Incorrect data length (num bytes): ID 0x11X\nExpecting: 2 bytes, Received: {len(raw_bytes)}")
    
    # pH is in format of pH * 1000
    raw = convert_from_little_endian_str(data_hex)
    actual = raw / 1000

    if (actual < 1 and actual != 0 or actual > 14):
        print(f"[ERROR]: pH data parsed as {actual}")  
        print(f"data_hex = {data_hex}")
        print(f"raw = {raw}")
        raise ValueError()  
    
    return {"pH": round(actual, 2)} 

def pH_parsing_fn(data_hex):
    raw_bytes = bytes.fromhex(data_hex)
    if len(raw_bytes) != 2:
        raise ValueError(f"Incorrect data length (num bytes): ID 0x11X\nExpecting: 2 bytes, Received: {len(raw_bytes)}")
    
    # pH is in format of pH * 1000
    raw = convert_from_little_endian_str(data_hex)
    actual = raw / 1000

    if (actual < 1 and actual != 0 or actual > 14):
        print(f"[ERROR]: pH data parsed as {actual}")  
        print(f"data_hex = {data_hex}")
        print(f"raw = {raw}")
        raise ValueError()  
    
    return actual


# temp data frame
def parse_0x10X_frame(data_hex):
    raw_bytes = bytes.fromhex(data_hex)
    if len(raw_bytes) != 3:
        raise ValueError("Incorrect data length (num bytes): ID 0x10X")
    
    # temp is in format of temp * 1000
    # raw = int.from_bytes(raw_bytes, "little") # is raw_bytes[0:2] really necessary?
    # actual = raw / 1000
    raw = convert_from_little_endian_str(data_hex)
    actual = (raw / 1000.0) - 273.15

    if (actual < -130 and actual != 0 or actual > 1350):
        print(f"[ERROR]: temp_sensor data parsed as {actual}")  
        print(f"data_hex = {data_hex}")
        print(f"raw = {raw}")
        raise ValueError()  
    
    return {"temp_sensor": round(actual, 3)}

def temp_sensor_parsing_fn(data_hex):
    raw_bytes = bytes.fromhex(data_hex)
    if len(raw_bytes) != 3:
        raise ValueError("Incorrect data length (num bytes): ID 0x10X")
    
    # temp is in format of temp * 1000
    raw = convert_from_little_endian_str(data_hex)
    actual = (raw / 1000.0) - 273.15

    if (actual < -130 and actual != 0 or actual > 1350):
        print(f"[ERROR]: temp_sensor data parsed as {actual}")  
        print(f"data_hex = {data_hex}")
        print(f"raw = {raw}")
        raise ValueError()  
    
    return actual

def make_pretty(cmd):
    '''
    Helper function for putting cansend commands into the same format as candump received messages\n
    '''
    try:
        frame_id = cmd[12:15]
        data = cmd[18:]
        data_length = int(len(data) / 2)
        padding = "0" if (data_length < 10) else ""
        data_nice = ""
        for i in range(len(data)):
            data_nice += data[i]
            if ((i % 2) == 1):
                data_nice += " "
        msg = can_line + "  " + frame_id + "  [" + padding + str(data_length) + "]  " + data_nice
    except Exception as e:
        print(f"ERROR - Command not logged: {str(e)}")
    
    return msg

### ---------- Data Objects ---------- ###
# pH_graph = create_graph("pH vs Time", "pH", 0, 15)
# pH_line, = pH_graph[2].plot([], [], 'r-', linewidth=linewidth, label='pH')
# pH_graph_obj = GraphObject(pH_graph, 0, 14)
# pH_label = create_label("pH: ---- ")
# pH_obj = DataObject("pH", 1, "", pH_parsing_fn, pH_graph_obj, pH_line, pH_label)

# Graph: x-axis name, y-axis name, line colour, max/min y-limits, x-units (from DataObject), y-units
# label: Internal only - should be able to use name from DataObject
# line: Internal only
# DataObject: parsing function, decimal places (dp), x-units
# pH_obj = DataObject("pH", 1, "", pH_parsing_fn, graph_obj)

# temp_sensor_graph = create_graph("Water Temp vs Time", "Temp (°C)", 0, 100)
# temp_sensor_line, = temp_sensor_graph[2].plot([], [], 'b-', linewidth=linewidth, label="Water Temp")
# temp_sensor_graph_obj = GraphObject(temp_sensor_graph, 0, 1400)
# temp_sensor_label = create_label("Water temp: ----   ")
# temp_sensor_obj = DataObject("Water_Temp", 3, "°C", temp_sensor_parsing_fn, temp_sensor_graph_obj, temp_sensor_line, temp_sensor_label)

# sal_graph = create_graph("Salinity vs Time", "Salinity (µS/cm)", 0, 100000)
# sal_line, = sal_graph[2].plot([], [], 'g-', linewidth=linewidth, label="Salinity")
# sal_graph_obj = GraphObject(sal_graph, 0, 550000)
# sal_label = create_label("Salinity: ----    ")
# sal_obj = DataObject("Salinity", 3, "µS/cm", sal_parsing_fn, sal_graph_obj, sal_line, sal_label)

# data_objs = [pH_obj, temp_sensor_obj, sal_obj]

# pdb_temp_graph = create_graph("Battery Temperatures vs Time", "Temp (°C)", 0, 100)
# temp1_line, = pdb_temp_graph[2].plot([], [], 'r-', label='Temp 1')
# temp2_line, = pdb_temp_graph[2].plot([], [], 'g-', label='Temp 2')
# temp3_line, = pdb_temp_graph[2].plot([], [], 'y-', label='Temp 3')
# pdb_temp_graph_obj = GraphObject(pdb_temp_graph, 0, 127.0)
# temp1_label = create_label("Temp1: ----  ")
# temp2_label = create_label("Temp2: ----  ")
# temp3_label = create_label("Temp3: ----  ")
# temp1_obj = DataObject("Temp1", 2, "°C", None, pdb_temp_graph_obj, temp1_line, temp1_label)
# temp2_obj = DataObject("Temp2", 2, "°C", None, None, temp2_line, temp2_label)
# temp3_obj = DataObject("Temp3", 2, "°C", None, None, temp3_line, temp3_label)

pdb_temp_graph_obj = GraphObject("Temperature", cg.graph_y, "°C", cg.graph_y_units, 0, 127.0)
temp1_obj = DataObject("Temp1", 2, "°C", None, line_colour="r", graph=pdb_temp_graph_obj)
temp2_obj = DataObject("Temp2", 2, "°C", None, line_colour="g", graph=pdb_temp_graph_obj)
temp3_obj = DataObject("Temp3", 2, "°C", None, line_colour="y", graph=pdb_temp_graph_obj)

pdb_volt_graph_obj = GraphObject("Cell Voltages", cg.graph_y, "V", cg.graph_y_units, 0, 5)
volt1_obj = DataObject("Volt1", 2, "V", None, line_colour="b", graph=pdb_volt_graph_obj)
volt2_obj = DataObject("Volt2", 2, "V", None, line_colour="c", graph=pdb_volt_graph_obj)
volt3_obj = DataObject("Volt3", 2, "V", None, line_colour="m", graph=pdb_volt_graph_obj)
volt4_obj = DataObject("Volt4", 2, "V", None, line_colour="orange", graph=pdb_volt_graph_obj)

# pdb_volt_graph = create_graph("Cell Voltages vs Time", "Voltage (V)", 0, 5)
# volt1_line, = pdb_volt_graph[2].plot([], [], 'b-', label='Volt 1')
# volt2_line, = pdb_volt_graph[2].plot([], [], 'c-', label='Volt 2')
# volt3_line, = pdb_volt_graph[2].plot([], [], 'm-', label='Volt 3')
# volt4_line, = pdb_volt_graph[2].plot([], [], 'orange', label='Volt 4')
# pdb_volt_graph_obj = GraphObject(pdb_volt_graph, 0, 3.5)
# volt1_label = create_label("Volt1: --- ")
# volt2_label = create_label("Volt2: --- ")
# volt3_label = create_label("Volt3: --- ")
# volt4_label = create_label("Volt4: --- ")
# volt1_obj = DataObject("Volt1", 2, "V", None, pdb_volt_graph_obj,volt1_line, volt1_label)
# volt2_obj = DataObject("Volt2", 2, "V", None, None,volt2_line, volt2_label)
# volt3_obj = DataObject("Volt3", 2, "V", None, None,volt3_line, volt3_label)
# volt4_obj = DataObject("Volt4", 2, "V", None, None,volt4_line, volt4_label)

# mppt_current_graph = create_graph("MPPT Current vs Time", "Amps (A)", 0, 5)
# mppt_hp_line, = mppt_current_graph[2].plot([], [], 'c-', label='Hull Port')
# mppt_hs_line, = mppt_current_graph[2].plot([], [], 'b-', label='Hull Starboard')
# mppt_sp_line, = mppt_current_graph[2].plot([], [], 'g-', label='Sail Port')
# mppt_ss_line, = mppt_current_graph[2].plot([], [], 'y-', label='Sail Starboard')
# mppt_current_graph_obj = GraphObject(mppt_current_graph, 0, 20)
# mppt_hp_label = create_label("MPPT_curr_hull_port: ---- ")
# mppt_hs_label = create_label("MPPT_curr_hull_starbd: ---- ")
# mppt_sp_label = create_label("MPPT_curr_sail_port: ---- ")
# mppt_ss_label = create_label("MPPT_curr_sail_starbd: ---- ")
# mppt_hp_obj = DataObject("MPPT_curr_hull_port", 2, "A", None, mppt_current_graph_obj, mppt_hp_line, mppt_hp_label)
# mppt_hs_obj = DataObject("MPPT_curr_hull_starbd", 2, "A", None, None, mppt_hs_line, mppt_hs_label)
# mppt_sp_obj = DataObject("MPPT_curr_sail_port", 2, "A", None, None, mppt_sp_line, mppt_sp_label)
# mppt_ss_obj = DataObject("MPPT_curr_sail_starbd", 2, "A", None, None, mppt_ss_line, mppt_ss_label)

mppt_current_graph_obj = GraphObject("MPPT Current", cg.graph_y, "A", cg.graph_y_units, 0, 5)
mppt_hp_obj = DataObject("MPPT_curr_hull_port", 2, "A", None, line_colour="c", graph=mppt_current_graph_obj)
mppt_sp_obj = DataObject("MPPT_curr_hull_starbd", 2, "A", None, line_colour="purple", graph=mppt_current_graph_obj)
mppt_hs_obj = DataObject("MPPT_curr_sail_port", 2, "A", None, line_colour="g", graph=mppt_current_graph_obj)
mppt_ss_obj = DataObject("MPPT_curr_sail_starbd", 2, "A", None, line_colour="y", graph=mppt_current_graph_obj)

# pdb_objs = [temp1_obj, temp2_obj, temp3_obj, volt1_obj, volt2_obj, volt3_obj, volt4_obj, mppt_hp_obj, mppt_hs_obj, mppt_sp_obj, mppt_ss_obj]

# rudder_graph = create_graph("Rudder Angles vs Time", "degrees (°)", -50, 50)
# actual_rudder_line, = rudder_graph[2].plot([], [], 'r-', linewidth=2, label='Actual Rudder Angle')
# set_rudder_line, = rudder_graph[2].plot([], [], 'b--', linewidth=2, label='Commanded Rudder Angle')
# rudder_graph_obj = GraphObject(rudder_graph, -90, 90)
# actual_rudder_label = create_label("Actual_rdr_deg: ---- ")
# set_rudder_label = create_label("Set_rdr_deg: ---- ")
# actual_rudder_obj = DataObject("Actual_rdr_deg", 2, "°", actual_rudder_parsing_fn, rudder_graph_obj, line=actual_rudder_line, label=actual_rudder_label)
# set_rudder_obj = DataObject("Set_rdr_deg", 2, "°", set_rudder_parsing_fn, line=set_rudder_line, label=set_rudder_label)

rudder_graph = GraphObject("Rudder Angles", cg.graph_y, "°", cg.graph_y_units, -90, 90)
actual_rudder_obj = DataObject("Actual_rdr_deg", 2, "°", None, line_colour="r", graph=rudder_graph) # NOTE: graph parsing function changed to None here - potential for bug/error
set_rudder_obj = DataObject("Set_rdr_deg", 2, "°", None, line_dashed=True, line_colour="b", graph=rudder_graph) # NOTE: graph parsing function changed to None here

# spd_over_gnd_graph = create_graph("Speed over ground vs Time", "Speed (km/h)", 0, 10)
# spd_over_gnd_line, = spd_over_gnd_graph[2].plot([], [], 'g-', linewidth=2, label="Speed over ground")
# spd_over_gnd_graph_obj = GraphObject(spd_over_gnd_graph, 0, 35)
# spd_over_gnd_label = create_label("Speed_over_gnd: ---- ")
# spd_over_gnd_obj = DataObject("Speed_over_gnd", 3, "km/h", None, spd_over_gnd_graph_obj, spd_over_gnd_line, spd_over_gnd_label)

spd_over_gnd_graph_obj = GraphObject("Speed Over Ground", cg.graph_y, "km/h", cg.graph_y_units, 0, 20)
spd_over_gnd_obj = DataObject("Speed_over_gnd", 3, "km/h", None, line_colour='brown', graph=spd_over_gnd_graph_obj)

# headings_graph = create_graph("IMU & Desired Headings vs Time", "degrees (°)", 0, 360)
# imu_heading_line, = headings_graph[2].plot([], [], 'r-', linewidth=2, label="IMU heading")
# desired_heading_line, = headings_graph[2].plot([], [], 'b--', linewidth=2, label="Desired heading")
# imu_heading_label = create_label("IMU_heading: ---- ")
# imu_heading_graph_obj = GraphObject(headings_graph, 0, 360)
# imu_heading_obj = DataObject("IMU_heading", 3, "°", None, imu_heading_graph_obj, imu_heading_line, imu_heading_label)
# desired_heading_label = create_label("Desired_heading: ---- ")
# desired_heading_obj = DataObject("Desired_heading", 3, "°", None, None, desired_heading_line, desired_heading_label)

headings_graph_obj = GraphObject("IMU & Desired Headings", cg.graph_y, "°", cg.graph_y_units, 0, 360)
imu_heading_obj = DataObject("IMU_heading", 3, "°", None, line_colour="r", graph=headings_graph_obj)
desired_heading_obj = DataObject("Desired_heading", 3, "°", None, line_dashed=True, line_colour="b", graph=headings_graph_obj)

# imu_roll_pitch_graph = create_graph("IMU Roll & Pitch vs Time","degrees (°)", 0, 360)
# imu_roll_line, = imu_roll_pitch_graph[2].plot([], [], 'g-', linewidth=2, label="IMU Roll")
# imu_pitch_line, = imu_roll_pitch_graph[2].plot([], [], 'brown', linewidth=2, label="IMU Pitch")
# imu_roll_pitch_graph_obj = GraphObject(imu_roll_pitch_graph, 0, 360)
# imu_roll_label = create_label("IMU_roll: ---- ")
# imu_pitch_label = create_label("IMU_pitch: ---- ")
# imu_roll_obj = DataObject("IMU_roll", 2, "°", None, imu_roll_pitch_graph_obj, imu_roll_line, imu_roll_label)
# imu_pitch_obj = DataObject("IMU_pitch", 2, "°", None, None, imu_pitch_line, imu_pitch_label)

imu_roll_pitch_graph_obj = GraphObject("IMU Roll & Pitch", cg.graph_y, "°", cg.graph_y_units, 0, 360)
imu_roll_obj = DataObject("IMU_roll", 2, "°", None, line_colour="g", graph=imu_roll_pitch_graph_obj)
imu_pitch_obj = DataObject("IMU_pitch", 2, "°", None, line_colour="brown", graph=imu_roll_pitch_graph_obj)

# int_der_graph = create_graph("IMU Integral & Derivative vs Time","", 0, 100)
# der_line, = int_der_graph[2].plot([], [], 'mediumseagreen', linewidth=2, label="Derivative")
# int_line, = int_der_graph[2].plot([], [], 'm--', linewidth=2, label="Integral")
# int_der_graph_obj = GraphObject(int_der_graph, 0, 360)
# int_label = create_label("IMU_integral: ---- ")
# der_label = create_label("IMU_derivative: ---- ")
# integral_obj = DataObject("IMU_integral", 2, "", None, int_der_graph_obj, int_line, int_label)
# derivative_obj = DataObject("IMU_derivative", 2, "", None, None, der_line, der_label)

int_der_graph_obj = GraphObject("IMU Integral & Derivative", cg.graph_y, None, cg.graph_y_units, 0, 100)
integral_obj = DataObject("IMU_integral", 2, None, None, line_colour="m", graph=int_der_graph_obj)
derivative_obj = DataObject("IMU_derivative", 2, None, None, line_colour="pink", graph=int_der_graph_obj)

# data_wind_spd_graph = create_graph("Data_Wind Speed vs Time", "Speed (knots)", 0, 20)
# data_wind_spd_line, = data_wind_spd_graph[2].plot([], [], 'purple', linewidth=2, label="Wind Speed")
# data_wind_spd_graph_obj = GraphObject(data_wind_spd_graph, 0, 360)
# data_wind_spd_label = create_label("Data_wind_spd: ---- ")
# data_wind_spd_obj = DataObject("Data_wind_spd", 0, "knots", None, data_wind_spd_graph_obj, data_wind_spd_line, data_wind_spd_label)

# data_wind_dir_graph = create_graph("Data_Wind Direction vs Time", "degrees (°)", 0, 360)
# data_wind_dir_line, = data_wind_dir_graph[2].plot([], [], 'orange', linewidth=2, label="Wind Direction")
# data_wind_dir_graph_obj = GraphObject(data_wind_dir_graph, 0, 360)
# data_wind_dir_label = create_label("Data_wind_dir: ---- ")
# data_wind_dir_obj = DataObject("Data_wind_dir", 0, "°", None, data_wind_dir_graph_obj, data_wind_dir_line, data_wind_dir_label)

# data_wind_objs = [data_wind_spd_obj, data_wind_dir_obj]

# # all objects with data from 0x204 frame (rudder -> mainframe)

# all_objs = pdb_objs + rudder_objs + [desired_heading_obj] + data_wind_objs # + data_objs
# TODO: PUT data_objs back for pH, salinity, water temp sensors

# Graph: x-axis name, y-axis name, line colour, max/min y-limits, x-units (from DataObject), y-units
# label: Internal only - should be able to use name from DataObject
# line: Internal only
# DataObject: parsing function, decimal places (dp), x-units
# pH_obj = DataObject("pH", 1, "", pH_parsing_fn, graph_obj)

pH_graph_obj = GraphObject("pH", cg.graph_y, None, cg.graph_y_units, 0, 14)
pH_obj = DataObject("pH", 1, None, pH_parsing_fn, line_colour="r", graph=pH_graph_obj)

temp_sensor_graph_obj = GraphObject("Water Temp", cg.graph_y, "°C", cg.graph_y_units, 0, 1400)
temp_sensor_obj = DataObject("Water_Temp", 3, "°C", temp_sensor_parsing_fn, line_colour="b", graph=temp_sensor_graph_obj)

# sal_graph = create_graph("Salinity vs Time", "Salinity (µS/cm)", 0, 100000)
# sal_line, = sal_graph[2].plot([], [], 'g-', linewidth=linewidth, label="Salinity")
# sal_graph_obj = GraphObject(sal_graph, 0, 550000)
# sal_label = create_label("Salinity: ----    ")
# sal_obj = DataObject("Salinity", 3, "µS/cm", sal_parsing_fn, sal_graph_obj, sal_line, sal_label)

sal_graph_obj = GraphObject("Salinity", cg.graph_y, "µS/cm", cg.graph_y_units, 0, 100000)
sal_obj = DataObject("Salinity", None, "µS/cm", sal_parsing_fn, line_colour='g', graph=sal_graph_obj)


pdb_objs = [temp1_obj, temp2_obj , temp3_obj, volt1_obj, volt2_obj, volt3_obj, volt4_obj, mppt_hp_obj, mppt_hs_obj, mppt_sp_obj, mppt_ss_obj]
rudder_objs = [actual_rudder_obj, set_rudder_obj, spd_over_gnd_obj, imu_roll_obj, imu_pitch_obj, integral_obj, derivative_obj, imu_heading_obj]
data_objs = [pH_obj, temp_sensor_obj, sal_obj]
all_objs = rudder_objs # pdb_objs # + data_objs