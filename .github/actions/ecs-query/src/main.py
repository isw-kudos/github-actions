#!/usr/bin/env python3
import json
import sys
import os
from typing import Any, Dict

# Add src to path properly
src_path = os.path.dirname(os.path.abspath(__file__))
if src_path not in sys.path:
    sys.path.insert(0, src_path)

from queries import (
    get_services,
    get_tasks,
    get_deployments,
    check_deployment_status,
)
from utils.formatters import format_output, generate_summary
from utils.aws_client import get_ecs_client
from utils.encoders import AWSEncoder


def get_env(name: str, default: str = None, required: bool = False) -> str:
    """Get GitHub Actions input as environment variable"""
    env_name = f'INPUT_{name.upper()}'
    value = os.getenv(env_name, default)

    if required and value is None:
        raise ValueError(f"Required input '{name}' not provided")

    return value


def set_output(name: str, value: Any) -> None:
    """Set GitHub Actions output"""
    output_file = os.getenv('GITHUB_OUTPUT')
    if output_file:
        with open(output_file, 'a') as f:
            # Handle different types appropriately
            if isinstance(value, bool):
                escaped_value = 'true' if value else 'false'
            elif isinstance(value, (int, float)):
                escaped_value = str(value)
            elif isinstance(value, str):
                # For strings, escape special characters but don't double-quote
                escaped_value = value.replace('\n', '%0A').replace('\r', '%0D')
            else:
                # For complex objects, use the custom encoder
                escaped_value = json.dumps(value, cls=AWSEncoder)

            f.write(f'{name}={escaped_value}\n')
    else:
        print(f"::debug::Output {name}={value}")


def log_info(message: str) -> None:
    """Log info message"""
    print(f"::notice::{message}")


def log_error(message: str) -> None:
    """Log error message"""
    print(f"::error::{message}")


def main():
    try:
        # Get inputs
        query_type = get_env('query-type', required=True)
        cluster = get_env('cluster', required=True)
        service = get_env('service')
        aws_region = get_env('aws-region', default='eu-west-1')
        filters_input = get_env('filters', default='{}')
        output_format = get_env('output-format', default='json')

        # Additional inputs for deployment status check
        target_task_definition = get_env('target-task-definition')
        expected_status = get_env('expected-status', default='COMPLETED')

        # Parse filters
        try:
            filters = json.loads(filters_input)
        except json.JSONDecodeError:
            filters = {}

        log_info(f"🔍 Running ECS query: {query_type} on cluster: {cluster}")

        # Initialize AWS ECS client
        ecs_client = get_ecs_client(aws_region)

        # Execute appropriate query
        result = None
        if query_type == 'services':
            result = get_services(ecs_client, cluster, filters)
        elif query_type == 'tasks':
            result = get_tasks(ecs_client, cluster, service, filters)
        elif query_type == 'deployments':
            result = get_deployments(ecs_client, cluster, service, filters)
        elif query_type == 'check-deployment':
            if not target_task_definition:
                raise ValueError("target-task-definition is required for check-deployment query")
            result = check_deployment_status(
                ecs_client,
                cluster,
                service,
                target_task_definition,
                expected_status
            )
        else:
            raise ValueError(f"Unknown query type: {query_type}")

        # Format and output results
        formatted_result = format_output(result, output_format)
        summary = generate_summary(result, query_type)
        count = len(result) if isinstance(result, list) else 1

        # Set outputs
        set_output('result', json.dumps(result, cls=AWSEncoder))
        set_output('summary', summary)
        set_output('count', count)

        # For check-deployment, also output success/failure
        if query_type == 'check-deployment' and isinstance(result, dict):
            set_output('success', result.get('success', False))
            set_output('rollout-state', result.get('rolloutState', 'UNKNOWN'))

        log_info(f"✅ Query complete. Found {count} items")
        print(formatted_result)

    except Exception as error:
        log_error(f"Action failed: {str(error)}")
        sys.exit(1)


if __name__ == '__main__':
    main()
