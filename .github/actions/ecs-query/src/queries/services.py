from typing import Any, Dict, List
import logging

logger = logging.getLogger(__name__)


def get_services(
        ecs_client: Any,
        cluster: str,
        filters: Dict[str, Any] = None
) -> List[Dict[str, Any]]:
    """
    Query ECS services with optional filters

    Filters:
    - status: SERVICE_ACTIVE or SERVICE_INACTIVE
    - minRunning: minimum running count
    - namePattern: regex pattern to match service name
    """
    filters = filters or {}

    try:
        # List all service ARNs
        response = ecs_client.list_services(cluster=cluster)
        service_arns = response.get('serviceArns', [])

        if not service_arns:
            return []

        # Describe services for detailed info
        services_response = ecs_client.describe_services(
            cluster=cluster,
            services=service_arns
        )
        services = services_response.get('services', [])

        # Apply filters
        return _apply_filters(services, filters)

    except Exception as e:
        logger.error(f"Failed to get services: {str(e)}")
        raise


def _apply_filters(
        services: List[Dict[str, Any]],
        filters: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Apply filters to services list"""
    import re

    filtered = []

    for service in services:
        # Filter by status
        if 'status' in filters:
            if service.get('status') != filters['status']:
                continue

        # Filter by minimum running count
        if 'minRunning' in filters:
            if service.get('runningCount', 0) < filters['minRunning']:
                continue

        # Filter by name pattern
        if 'namePattern' in filters:
            pattern = filters['namePattern']
            service_name = service.get('serviceName', '')
            if not re.search(pattern, service_name):
                continue

        filtered.append(service)

    return filtered
