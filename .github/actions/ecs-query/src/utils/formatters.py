from typing import Any, Dict, List
import json
from tabulate import tabulate
from .encoders import AWSEncoder


def format_output(
        data: Any,
        format_type: str = 'json'
) -> str:
    """Format query results"""
    if format_type == 'json':
        return json.dumps(data, indent=2, default=str, cls=AWSEncoder)
    elif format_type == 'table':
        return format_as_table(data)
    elif format_type == 'summary':
        return format_as_summary(data)
    elif format_type == 'compact':
        return format_as_compact(data)
    else:
        return json.dumps(data, indent=2, default=str, cls=AWSEncoder)


def format_as_table(data: Any) -> str:
    """Format as readable ASCII table"""
    if not data:
        return "No data"

    if isinstance(data, list):
        if not data:
            return "No data"

        # Extract useful columns and flatten/truncate
        rows = []
        for item in data:
            row = _flatten_item(item)
            rows.append(row)

        if not rows:
            return "No data"

        headers = list(rows[0].keys())
        table_rows = [list(row.values()) for row in rows]

        return tabulate(table_rows, headers=headers, tablefmt='grid', maxcolwidths=40)

    return str(data)


def format_as_compact(data: Any) -> str:
    """Format as compact readable output (better for logs)"""
    if not data:
        return "No data"

    if not isinstance(data, list):
        data = [data]

    output = []
    for i, item in enumerate(data, 1):
        output.append(f"\n{'=' * 80}")
        output.append(f"Item {i}:")
        output.append('=' * 80)

        for key, value in item.items():
            if isinstance(value, (list, dict)):
                output.append(f"  {key}:")
                output.append(f"    {json.dumps(value, indent=6, cls=AWSEncoder)}")
            else:
                output.append(f"  {key}: {value}")

    return "\n".join(output)


def _flatten_item(item: Dict[str, Any], max_length: int = 40) -> Dict[str, str]:
    """
    Flatten and truncate item for table display

    Useful columns to show for ECS:
    - serviceName / taskDefinitionArn
    - status
    - runningCount / desiredCount
    - createdAt / lastStatus
    """
    flattened = {}

    # Priority keys to show for services
    priority_keys = [
        'serviceName', 'taskDefinitionArn', 'family',
        'status', 'lastStatus',
        'runningCount', 'desiredCount',
        'pendingCount',
        'createdAt', 'updatedAt',
    ]

    # Add priority keys if they exist
    for key in priority_keys:
        if key in item and item[key] is not None:
            flattened[key] = _truncate_value(item[key], max_length)

    # Add any remaining simple values
    for key, value in item.items():
        if key not in flattened and isinstance(value, (str, int, float, bool)):
            flattened[key] = _truncate_value(value, max_length)

    return flattened


def _truncate_value(value: Any, max_length: int = 40) -> str:
    """Convert value to string and truncate if needed"""
    str_value = str(value)

    if len(str_value) > max_length:
        return str_value[:max_length - 3] + "..."

    return str_value


def format_as_summary(data: Any) -> str:
    """Format as summary"""
    if isinstance(data, list):
        count = len(data)
        if count > 0:
            # Show a summary for each item
            summary = f"Total: {count} item(s)\n\n"
            for i, item in enumerate(data, 1):
                summary += f"{i}. "
                # Try to get a name/identifier
                if 'serviceName' in item:
                    summary += f"{item['serviceName']}"
                elif 'taskDefinitionArn' in item:
                    arn_parts = item['taskDefinitionArn'].split('/')
                    summary += f"{arn_parts[-2] if len(arn_parts) > 1 else item['taskDefinitionArn']}"
                elif 'family' in item:
                    summary += f"{item['family']}"
                else:
                    summary += str(list(item.values())[0] if item else "Unknown")

                # Add status if available
                if 'status' in item:
                    summary += f" - {item['status']}"
                elif 'lastStatus' in item:
                    summary += f" - {item['lastStatus']}"

                summary += "\n"
            return summary
        else:
            return "Total: 0 items"
    elif isinstance(data, dict):
        return f"Total items: {len(data)}"
    else:
        return str(data)


def generate_summary(data: Any, query_type: str) -> str:
    """Generate summary text"""
    count = len(data) if isinstance(data, (list, dict)) else 0
    return f"{query_type}: {count} items found"
