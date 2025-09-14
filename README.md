# polaris-debug-tools
Providing debug tools for testing of POLARIS's systems.

Note: V3 is the most updated version; V4 is still in progress.

Steps for setting up mainframe/CAN stuff (for testing)
- Need: 1 nucleo with CAN hat (use a CAN test board) to transmit CAN messages, bullet wifi modem, ethernet cable for bullet, CAN connector with wires thing (white = 12V power, black = ground, brown = CAN high, blue = CAN low), micro-USB cable, assorted alligator clips
1. Connect bullet to mainframe with ethernet cable
2. Set up power supply (12V, 2A), connect power & ground appropriately - green, yellow light for ethernet, red lights on for pi = correct setup
3. Connect nucleo to mainframe (Nucleo wires: white = CAN high, blue = CAN low, green = ground)
4. Ensure laptop is connected to raye_wifi; "sudo putty" on ubuntu laptop or just open putty; On ubuntu laptop, do serial SSH with serial line /dev/ttyACM0, baudrate = 115200 (static ip address: sailbot@192.168.0.10)
5. If necessary, re-flash nucleo with code "FDCAN_Serial" - on github somewhere - ask Alisha if necessary
6. Set up can line on raspberry pi (run ip up)

note: add auto setup of can line (run ip up)
note: add function to reset can line (down then up)
