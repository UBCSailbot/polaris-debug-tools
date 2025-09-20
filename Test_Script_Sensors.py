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
delay = 5

# CAN Frame IDs
temp_id = "100" # 0x10X
pH_id = "110" # 0x11X
sal_id = "120" # 0x12X

### ----------  Utility Functions ---------- ###
def convert_to_hex(decimal, num_digits):
    return format(decimal, "X").zfill(num_digits)

def convert_to_little_endian(hex_str):
    raw = bytes.fromhex(hex_str)
    return raw[::-1].hex()

# Use this function to CAN send a frame for any data sensor
def send_sensor_command(client, frame_id, data):
    try:
        # Convert data to CAN format (2-byte hex number in little endian)
        # Multiplied by 1000 by CAN Frame documentation
        can_data = int(data * 1000)
        hex = convert_to_little_endian(convert_to_hex(can_data, 4))
        can_msg = "cansend can1 " + frame_id + "##1" + hex

        # Execute the cansend command
        stdin, stdout, stderr = client.exec_command(can_msg)
        
        # Check for errors
        error = stderr.read().decode().strip()
        output = stdout.read().decode().strip()

        if error:
            print(f"ERROR sending command: {error}")
            return False
        else:
            print(f"✓ Data sent: {data}° - CAN message: {can_msg}")
            return True

    except Exception as e:
        print(f"Error sending cansend command: {e}")
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
        
        while True:
            cycle_count += 1
            print(f"--- CYCLE {cycle_count} ---")
            
            # Generate random pH between 0 and 14
            pH_data = round(random.uniform(0, 14))
            
            current_time = time.time()
            timestamp = datetime.now().strftime('%H:%M:%S')
            
            # Calculate total elapsed time
            total_elapsed = current_time - start_time
            print(f"[{timestamp}] Total elapsed time: {total_elapsed:.1f}s")
            
            print(f"[{timestamp}] ", end="")
            success = send_sensor_command(client, pH_id, pH_data)
            
            if not success:
                print("Failed to send command, continuing...")
            
            print(f"[{timestamp}] Waiting 30 seconds before next angle...")
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
        print("RUDDER ACTUATION TEST COMPLETED")
        print("=" * 60)

if __name__ == "__main__":
    main()
