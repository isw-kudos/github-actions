from typing import Any, Dict, List
import logging

logger = logging.getLogger(__name__)


def get_tasks(
        ecs_client: Any,
        cluster: str,
        service: str = None,
        filters: Dict[str, Any] = None
) -> List[Dict[str, Any]]:
    """
    Query ECS tasks with optional filters

    Filters:
    - desiredStatus: RUNNING or STOPPED
    - exitCode: exit code number
    - family: task family pattern
    """
    filters = filters or {}

    try:
        # List task ARNs
        list_params = {
            'cluster': cluster,
            'desiredStatus': filters.get('desiredStatus', 'RUNNING'),
        }

        if service:
            list_params['serviceName'] = service

        response = ecs_client.list_tasks(**list_params)
        task_arns = response.get('taskArns', [])

        if not task_arns:
            return []

        # Describe tasks for detailed info
        tasks_response = ecs_client.describe_tasks(
            cluster=cluster,
            tasks=task_arns
        )
        tasks = tasks_response.get('tasks', [])

        return _apply_filters(tasks, filters)

    except Exception as e:
        logger.error(f"Failed to get tasks: {str(e)}")
        raise


def _apply_filters(
        tasks: List[Dict[str, Any]],
        filters: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Apply filters to tasks list"""
    filtered = []

    for task in tasks:
        # Filter by exit code
        if 'exitCode' in filters:
            containers = task.get('containers', [])
            if containers:
                exit_code = containers[0].get('exitCode')
                if exit_code != filters['exitCode']:
                    continue

        # Filter by task family
        if 'family' in filters:
            if filters['family'] not in task.get('taskDefinitionArn', ''):
                continue

        filtered.append(task)

    return filtered
