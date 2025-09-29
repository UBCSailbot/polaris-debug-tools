

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

    hex_list[-1] = hex(int(hex_list[-1], 16) + 1).replace("0x", "")
    return "".join(hex_list)

def test(line):
    parts = line.split()
    frame_id = parts[1].lower()
    print("Frame id: ", frame_id)
    if (frame_id == "121"):
        print("True!")
    else:
        print("False")
    raw_data = line.split(']')[-1].strip().split()
    return raw_data

if __name__ == "__main__":
    # print(test("can1 [121] 30e1"))
    # can_data = 0xc05d9600401fc8e158313075
    # print(str(can_data))
    print(2 ** ((4 * 8) - 1) - 1)
    while (True):
        data = input("\nEnter data: ")
        hexed = convert_to_hex(int(data), 4)
        print(f"convert_to_hex(input, 4 bytes) = {hexed}")
        little_endian = convert_to_little_endian(hexed)
        print(f"convert_to_little_endian(hexed)= {little_endian}")
        back_to_int = convert_from_little_endian_str(little_endian)
        print(f"received int: {back_to_int} (using convert_from_little_endian(little_endian_hex_str))")




# === Multiprocessing Basics ===
#import multiprocessing
#
# def hello(name, date, location):
#     print("Hello, ", name, " at ", date, " in ", location)

# if __name__ == "__main__":
#     p = multiprocessing.Process(target=hello, args=("Breanne", "now", "Rome"))
#     p.start()
#     # p.join()
