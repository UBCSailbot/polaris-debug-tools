# polaris-debug-tools
Providing debug tools for testing of POLARIS's systems.

Note: V10 is the most updated (working) version.
      V9 is the most updated version tested with physical sensors.
Version Descriptions:
- V4.1 - V4 + graph of pH sensor only
- V5 - V4 + graph of pH sensor + graphing functionality
- V5.5 - V4 + graph of pH sensor + graphing functionality + logging functionality
- V6 - V5.5 + temp sensor graphics/functionality + salinity sensor graphics/functionality
- V7 - Fixed "starts plotting only when pdb command is sent" problem
- ignoring - V7 + ignoring absurd data from possible issues with parsing
- V8 - Fix data issues - logging data incorrectly, appears to be parsing incorrectly
- V8_tabs - Improves UI to more easily view graphs
- V9 - Changed parsing for temperature, Revert UI
- V10 - refactoring to more easily add stuff
- V11 - V10 + added visuals for existing data sensor values (pH, water temp, salinity)
- V12 - V11 + new DRV/PWR data and graph visuals/functionality

47400 sal max


Important usage notes
- May need to put CAN line down and back up before CAN works properly
- salinity is measured in big numbers - assumes range is between 40,000 and 55,000, graphs values in units of µS/cm * 1000
- temp is assumed to be between -15 and 140 degrees celsius
- If Raspberry pi is returning the message "device or resource busy" when attempting to put up CAN1 line with loopback on, and you have confirmed no other application/session is using the pi, try "sudo reboot"


Steps for setting up mainframe/CAN stuff (for testing)
- Need: mainframe, 1 nucleo with CAN hat (use a CAN test board) to transmit CAN messages, bullet wifi modem, special ethernet cable for bullet - mainframe, CAN connector with wires thing (white = 12V power, black = ground, brown = CAN high, blue = CAN low), micro-USB cable, assorted alligator clips
1. Connect bullet to mainframe with ethernet cable
2. Set up power supply (12V, 2A), connect power & ground appropriately - green, yellow light for ethernet, red lights on for pi = correct setup
3. Connect nucleo to mainframe (Nucleo wires: white = CAN high, blue = CAN low, green = ground)
4. Ensure laptop is connected to raye_wifi; "sudo putty" on ubuntu laptop or just open putty; On ubuntu laptop, do serial connection for nucleo with serial line /dev/ttyACM0, baudrate = 115200 (static ip address: sailbot@192.168.0.10)
    - Login as: "sailbot"; password is "sailbot" (without the quotation marks)
    - Note: to connect to the PI on the bullet connect to raye_wifi and run ssh sailbot@192.168.0.10 . For first time you will also likely have to configure your own IPv4 settings to an IP like 192.168.0.xx where xx is any number but 10 and netmask to 255.255.255.0. (Don't set a gateway.) Turn your wifi off and on and now you should always be setup to ssh in for all future connections. See below for how to do this on Linux and see Adarsh's message for how to do this on Windows.
5. If necessary, re-flash nucleo with code "FDCAN_Serial" - on github somewhere - ask Alisha if necessary
6. Set up can line on raspberry pi (run ip up)
7. Run GUI

note: add auto setup of can line (run ip up) to program
note: add function to reset can line (down then up)

"Can1 down", "sudo ip link set can1 down"
Regular CAN up:
"CAN1 Up", "sudo ip link set can1 up type can bitrate 500000 dbitrate 1000000 fd on"
CAN up command with loopback (use if using candump can1):
"CAN1 Up", "sudo ip link set can1 up type can bitrate 500000 dbitrate 1000000 fd on loopback on"
