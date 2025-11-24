

# SSH Credentials
hostname = "192.168.0.10"
username = "sailbot"
password = "sailbot"

can_line = "can0"

value_label_min_width = 100
value_label_max_height = 40

value_style = """
            color: black;
            font-size: 16px;
            font-weight: bold;
            font-family: 'Courier New', monospace;
            padding: 1px;
            background-color: #f0f0f0;
            border: 2px solid #cccccc;
            border-radius: 3px;
            margin: 2px;
        """
bold_text = "font-weight: bold;"

linewidth = 2
graph_bg = "w"
graph_title_style = ["black", "10pt"]
graph_label_style = {
    "color": "black",
    "font-size": "15px"
}

graph_y = "Time"
graph_y_units = "s"
graph_ylabel = "Time (s)" # all graphs read in seconds
graph_min_width = 275
graph_min_height = 250
scroll_window = 60 # in seconds