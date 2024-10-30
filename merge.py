def process_input():
    # Read multiline input from the user
    print("Enter your input (end with an empty line):")
    input_lines = []
    while True:
        line = input()
        if line == "":
            break
        input_lines.append(line)
    
    # Split each line by "|" and collect elements in a set to remove duplicates
    elements = set()
    for line in input_lines:
        parts = line.split("|")
        for part in parts:
            if part.startswith("#"):
                elements.add(part)
    
    # Join the elements back together using "|"
    result = "|".join(elements)
    
    return result

if __name__ == "__main__":
    result = process_input()
    print("Processed output:")
    print(result)