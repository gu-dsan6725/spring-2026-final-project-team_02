# pytest configuration and shared fixtures
import os
import sys

import pytest


@pytest.fixture(autouse=True)
def add_src_to_path():
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../src")))
    yield
    sys.path.pop(0)
