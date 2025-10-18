import matplotlib.pyplot as plt
from matplotlib.backends.backend_qt5agg import FigureCanvasQTAgg as FigureCanvas
from matplotlib.figure import Figure
from PyQt5.QtWidgets import (
    QLabel
)
from datetime import datetime

# class LineObject:
#     def __init__(self, line: plt.Line2D):
#         self.line = line
#         self.data = {} # no data when initialized: of form time:value
#         self.current = None # key of most recent data entry datapoint 

#     def get_current(self):
#         return self.current, self.data[self.current] # returns the time, value of most recently logged datapoint
    
#     def add_datapoint(self, time, data):
#         self.data[time] = data
#         self.current = time
#         values = []
#         for key in self.data.keys:
#             values.append(self.data[key])
#         self.line.set_data(self.data.keys, values)


# data is a dictionary with values = data logged, keys = time logged
class GraphObject: # struct which keeps together objects needed for a graph
    def __init__(self, figure: plt.Figure, canvas: FigureCanvas, ax: plt.Axes): # data = history?
        self.figure = figure
        self.canvas = canvas
        self.ax = ax
        self.lines = [] # list of line objects - each line contains its own data so to speak
        # for line in lines:
        #     line_obj = LineObject(line)
        #     self.lines.append(line_obj)
        # self.ax.legend()
        return

    # def add_line(self, line):
    #     # TODO
    #     self.ax.legend()
    #     return

    # modify ylim based on the datapoints in the graph
    # just don't call it for pH
    # this replaces Auto Y adjustment
    def adjust_ylim():
        pass

class DataObject:
    def __init__(self, name, units, parsing_fn, graph: GraphObject = None, line: plt.Line2D = None, label: QLabel = None):
        self.name = name
        self.units = units
        self.parsing_fn = parsing_fn
        self.graph = graph
        self.line = line
        self.label = label
        self.data = {} # no data when initialized: of form time:value
        self.current = None # key of most recent data entry datapoint

        return 

    # Return a tuple with the time:value of the most current data point collected
    def get_current(self):
        return self.current, self.data[self.current] if not None else 0 # returns the time, value of most recently logged datapoint
    
    # add a datapoint to self.data (history equivalent)
    def add_datapoint(self, time, data):
        self.data[time] = data
        self.current = time
        values = []
        for key in self.data.keys():
            values.append(self.data[key])
        self.line.set_data(list(self.data.keys()), values)
        return


    def parse_frame(self, current_time, data_line):
        # calls the specific parsing_fn that belongs to this object
        # calls add_datapoint to add data
        raw_data = data_line.split(']')[-1].strip().split()
        data = self.parsing_fn(''.join(raw_data))
        self.add_datapoint(current_time, data)
        return

    # if there is a graph associated with this object and there are some data points outside of the graph window,
    # remove those points - make sure to log those points before calling update_data
    # so this function should be called by log_data
    # also not sure of which parameters are necessary
    def update_data(self, current_time, graph_window):
        # TODO
        return

    
