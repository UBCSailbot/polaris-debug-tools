"""
Simple CAN Frame send Test Script for Sensors (pH, Temp, Salinity)
Automatically SSHes into rpi and sends a CAN Frame simulating pH sensor every delay secs
(TODO: modify to be all sensors) (TODO: time between messages make it shorter)
Outputs support messages through terminal

Use Ctrl+C to stop the test
"""

import paramiko
import time
import random
from datetime import datetime

# SSH Credentials
hostname = "192.168.0.10"
username = "sailbot"
password = "sailbot"

# Time between sent frames (in secs)
delay = 6

# CAN Frame IDs
temp_sensor_id = "100" # 0x10X
pH_id = "110" # 0x11X
sal_id = "120" # 0x12X

# Hex Two's complement conversion dict
hex_conversion = {
    "0": "f",
    "1": "e",
    "2": "d",
    "3": "c",
    "4": "b",
    "5": "a",
    "6": "9",
    "7": "8",
    "8": "7",
    "9": "6",
    "a": "5",
    "b": "4",
    "c": "3",
    "d": "2",
    "e": "1",
    "f": "0",
}

negative_hex_starting_digits = ["8", "9", "a", "b", "c", "d", "e", "f"]

### ----------  Utility Functions ---------- ###
# def convert_to_hex(decimal, num_bytes):
#     if (decimal < 0):
#         decimal = ~decimal + 1 # Two's complement for negative ints
#         print(f"After two's complement in convert_to_hex: {decimal}")

#     return format(decimal, "X").zfill(2 * num_bytes)

# def convert_to_little_endian(hex_str):
#     print(f"convert_to_little_endian: Given hex string: {hex_str}")
#     if (hex_str[0] == '-'):
#         hex_str[0] = 0
#         for i in range(1, hex_str.len()):
#             hex_str[i] = hex_conversion[i]

#     raw = bytes.fromhex(hex_str)
#     return raw[::-1].hex()

# def convert_from_bytes(num_in_bytes):
#     return int.from_bytes(num_in_bytes)

def convert_to_hex(decimal, num_bytes):
    # if (decimal < 0):
    #     decimal = ~decimal + 1 # Two's complement for negative ints
    #     print(f"After two's complement in convert_to_hex: {decimal}")

    if (abs(decimal) > ((2 ** ((num_bytes * 8) - 1)) - 1)):
        raise ValueError("Number is too large for given number of bytes")

    hexed = format(decimal, "X").zfill(2 * num_bytes)
    hex_list = list(hexed)
    print(hex_list)
    if (hex_list[0] == '-'):
        if len(hex_list) == (2 * num_bytes):
            hex_list[0] = "0"
        else:
            hex_list = hex_list[1:]
        print(hex_list)
        hexed = "".join(hex_list)
        return twos_complement(hexed)

    return format(decimal, "X").zfill(2 * num_bytes)

def convert_to_little_endian(hex_str):
    print(f"convert_to_little_endian: Given hex string: {hex_str}")
    # hex_list = list(hex_str)
    # if (hex_list[0] == '-'):
    #     hex_list[0] = "0"
    #     new_str = "".join(hex_list)
    #     new_str = twos_complement(new_str)

    raw = bytes.fromhex(hex_str)
    return raw[::-1].hex()

def convert_from_little_endian_str(hex_str):
    raw = bytes.fromhex(hex_str)
    big_endian = raw[::-1].hex()
    if big_endian[0] in negative_hex_starting_digits:
        return int(twos_complement(big_endian), 16) * -1
    return int(big_endian, 16)

def twos_complement(hex_str):
    hex_list = list(hex_str)
    for i in range(0, len(hex_list)):
        hex_list[i] = hex_conversion[hex_list[i].lower()]

    print(f"twos_complement before replace = {"".join(hex_list)}")
    final_string = hex(int("".join(hex_list), 16) + 1).replace("0x", "")
    # hex_list[-1] = hex(int(hex_list[-1], 16) + 1)
    # print(f"twos_complement hex_list after adding 1 = {"".join(hex_list)}")
    # hex_list[-1] = hex_list[-1][2:]
    print(f"twos_complement hex_list after full replace = {"".join(hex_list)}")
    return final_string

def send_pdb_command(client):
    try:
        # Send sample pdb command with data: 
        # volt1: 3 volt2: 2.4 volt3: 0.8 volt4: 1.3 temp1: 1.5 temp2: 57.8 temp3: 126.32
        # Convert data to CAN format (2-byte hex number in little endian)
        # Multiplied by 1000 by CAN Frame documentation
        # can_data = 0x5dc0 0096 1f40 e1c8 3158 7530
        can_data = "c05d9600401fc9416075c8325831"
        can_msg = "cansend can1 206##1" + can_data

        # Execute the cansend command
        stdin, stdout, stderr = client.exec_command(can_msg)
        
        # Check for errors
        error = stderr.read().decode().strip()
        output = stdout.read().decode().strip()

        if error:
            print(f"ERROR sending command: {error}")
            return False
        else:
            print(f"✓ Sample PDB msg sent: {can_msg}")
            return True

    except Exception as e:
        print(f"Error sending cansend command: {e}")
        return False
    pass

# Use this function to CAN send a frame for any data sensor
def send_sensor_command(client, frame_id, data: float):
    try:
        # Convert data to CAN format (2-byte hex number in little endian)
        # Multiplied by 1000 by CAN Frame documentation
        print(f"Data passed to send_sensor_command: {data}")
        can_data = int(data * 1000)
        print("data converted to int, * 1000: ", can_data)
        hexed_data = convert_to_hex(can_data, 4)
        print("data converted to hex: ", hexed_data)
        hex_bytes = convert_to_little_endian(hexed_data)
        can_msg = "cansend can1 " + frame_id + "##1" + hex_bytes

        # Execute the cansend command
        stdin, stdout, stderr = client.exec_command(can_msg)
        
        # Check for errors
        error = stderr.read().decode().strip()
        output = stdout.read().decode().strip()

        if error:
            print(f"ERROR sending command: {error}")
            return False
        else:
            sent = convert_from_little_endian_str(hex_bytes) / 1000
            print(f"✓ Data sent: {sent} - CAN message: {can_msg}")
            return True
        
    except Exception as e:
        print(f"Error sending cansend command: {e}")
        print(f"Attempted command: {can_msg}")
        return False

def send_rudder_command(client, angle):
    """Send rudder CAN message via SSH"""
    try:
        # Convert angle to CAN message format (same as Remote_Debugger_V3.py)
        # Convert float angle to integer for hex conversion
        angle_int = int((angle + 90) * 1000)
        value = convert_to_hex(angle_int, 8)
        can_message = "cansend can1 001##1" + convert_to_little_endian(value) + "80"
        
        # Execute the cansend command
        stdin, stdout, stderr = client.exec_command(can_message)
        
        # Check for errors
        error = stderr.read().decode().strip()
        output = stdout.read().decode().strip()
        
        if error:
            print(f"ERROR sending command: {error}")
            return False
        else:
            print(f"✓ Rudder set to {angle:7.3f}° - CAN message: {can_message}")
            return True
            
    except Exception as e:
        print(f"Exception sending rudder command: {e}")
        return False

def main():
    print("=" * 60)
    print("SENSOR TEST SCRIPT")
    print("=" * 60)
    print(f"Target: {hostname}")
    print(f"Username: {username}")
    print(f"Sends CAN Frame for pH sensor with random data every {delay} secs")
    print("=" * 60)
    
    # Connect to SSH
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Connecting to SSH...")
        client.connect(hostname, username=username, password=password)
        print(f"[{datetime.now().strftime('%H:%M:%S')}] SSH connection established!")
        
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Starting test...")
        print("Press Ctrl+C to stop the test\n")
        
        cycle_count = 0
        start_time = time.time()

        send_pdb_command(client)
        time.sleep(delay)
        send_pdb_command(client)
        time.sleep(delay)
        
        while True:
            cycle_count += 1
            print(f"--- CYCLE {cycle_count} ---")

            # send_pdb_command(client)
            # time.sleep(delay)
            
            # Generate random pH between 0 and 14
            pH_data = round(random.uniform(0, 14))
            temp_sensor_data = round(random.uniform(-14, 140), 3)
            # print(f"generated temp_sensor_data: {temp_sensor_data}")
            sal_data = round(random.uniform(35000, 60000)) # Expect data points between 35,000-60,000 µS/cm
            
            current_time = time.time()
            timestamp = datetime.now().strftime('%H:%M:%S')
            
            # Calculate total elapsed time
            total_elapsed = current_time - start_time
            print(f"[{timestamp}] Total elapsed time: {total_elapsed:.1f}s")
            
            print(f"[{timestamp}] ", end="")

            # success = send_sensor_command(client, sal_id, sal_data)
            # if not success:
            #     print("Failed to send command, continuing...")

            # === For combining frames randomly ===
            rnd_cmd = random.randrange(2)
            if (rnd_cmd == 0): # send pH + temp_sensor frame
                success = send_sensor_command(client, pH_id, pH_data)
                if not success:
                    print("Failed to send command, continuing...")

                success = send_sensor_command(client, temp_sensor_id, temp_sensor_data)
                if not success:
                    print("Failed to send command, continuing...")

            elif (rnd_cmd == 1): # send temp_sensor + salinity frame
                success = send_sensor_command(client, temp_sensor_id, temp_sensor_data)
                if not success:
                    print("Failed to send command, continuing...")
                success = send_sensor_command(client, sal_id, sal_data)
                if not success:
                    print("Failed to send command, continuing...")

            else: # Send salinity + ph + temp frame
                success = send_sensor_command(client, sal_id, sal_data)
                if not success:
                    print("Failed to send command, continuing...")

                success = send_sensor_command(client, pH_id, pH_data)
                if not success:
                    print("Failed to send command, continuing...")

                success = send_sensor_command(client, temp_sensor_id, temp_sensor_data)
                if not success:
                    print("Failed to send command, continuing...")
            
            print(f"[{timestamp}] Waiting {delay} seconds before next cansend...")
            time.sleep(delay)  # Wait 30 seconds before next angle
    
    except KeyboardInterrupt:
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Test stopped by user (Ctrl+C)")
    
    except paramiko.AuthenticationException:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] SSH Authentication failed!")
        print("Check username/password credentials")
    
    except paramiko.SSHException as e:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] SSH connection error: {e}")
    
    except Exception as e:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Unexpected error: {e}")
    
    finally:
        client.close()
        print(f"[{datetime.now().strftime('%H:%M:%S')}] SSH connection closed")
        print("=" * 60)
        print("SENSOR DATA CANSEND TEST COMPLETED")
        print("=" * 60)

if __name__ == "__main__":
    main()
