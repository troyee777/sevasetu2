import sys
import os

# Tell Python to look in the main root folder for your files
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import the Flask 'app' object from your main app.py file
from app import app