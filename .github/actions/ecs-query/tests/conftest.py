import os
import sys
import pytest
from unittest.mock import MagicMock

# Ensure the action's src directory is importable for tests
TESTS_DIR = os.path.dirname(__file__)
SRC_DIR = os.path.abspath(os.path.join(TESTS_DIR, '..', 'src'))
if SRC_DIR not in sys.path:
    sys.path.insert(0, SRC_DIR)


@pytest.fixture
def mock_ecs_client():
    """Mock ECS client for testing"""
    return MagicMock()


@pytest.fixture
def sample_services():
    """Sample service data"""
    return [
        {
            'serviceName': 'api-service',
            'status': 'ACTIVE',
            'runningCount': 3,
            'desiredCount': 3,
        },
        {
            'serviceName': 'web-service',
            'status': 'ACTIVE',
            'runningCount': 2,
            'desiredCount': 2,
        },
    ]
