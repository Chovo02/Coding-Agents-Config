def parse_port(text):
    """Parse a TCP port from user input."""
    port = int(text)
    if port > 65535:
        raise ValueError("port out of range")
    return port
