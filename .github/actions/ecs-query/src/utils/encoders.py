import json
from datetime import datetime, date
from decimal import Decimal


class AWSEncoder(json.JSONEncoder):
    """Custom JSON encoder for AWS SDK responses"""

    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        elif isinstance(obj, date):
            return obj.isoformat()
        elif isinstance(obj, Decimal):
            # For DynamoDB Decimal types
            return float(obj)
        elif hasattr(obj, '__dict__'):
            return obj.__dict__
        return super().default(obj)
