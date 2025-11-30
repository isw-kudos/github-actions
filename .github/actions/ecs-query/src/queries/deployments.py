from typing import Any, Dict, List
import logging

logger = logging.getLogger(__name__)


def get_deployments(
        ecs_client: Any,
        cluster: str,
        service: str,
        filters: Dict[str, Any] = None
) -> List[Dict[str, Any]]:
    """
    Query ECS service deployments

    Returns deployment information including primary and active deployments
    """
    print(f"::debug::get_deployments called with cluster={cluster}, service={service}")

    filters = filters or {}

    if not service:
        raise ValueError("Service name is required for deployment queries")

    try:
        # Describe the service to get deployment info
        response = ecs_client.describe_services(
            cluster=cluster,
            services=[service]
        )

        if not response.get('services'):
            return []

        service_obj = response['services'][0]
        service_arn = service_obj.get('serviceArn')
        deployments = service_obj.get('deployments', [])

        # Extract region and account from service ARN
        arn_parts = service_arn.split(':')
        region = arn_parts[3]
        account_id = arn_parts[4]

        # Get deployment ARNs using list_service_deployments
        deployment_arns_map = _get_deployment_arns(ecs_client, cluster, service)

        # Enrich deployments with ARNs
        enriched_deployments = []
        for i, deployment in enumerate(deployments):
            deployment = _enrich_deployment(
                deployment,
                cluster,
                service,
                region,
                account_id,
                deployment_arns_map,
                i
            )
            enriched_deployments.append(deployment)

        return _apply_filters(enriched_deployments, filters)

    except Exception as e:
        logger.error(f"Failed to get deployments: {str(e)}")
        raise


def check_deployment_status(
        ecs_client: Any,
        cluster: str,
        service: str,
        target_task_definition: str,
        expected_status: str = "COMPLETED"
) -> Dict[str, Any]:
    """
    Check if a deployment for a specific task definition has completed successfully.

    Uses describe_services to find the deployment by task definition,
    then gets full status from list_service_deployments.
    """
    try:
        # First, use describe_services to find the deployment by task definition
        describe_response = ecs_client.describe_services(
            cluster=cluster,
            services=[service]
        )

        if not describe_response.get('services'):
            return {
                'found': False,
                'message': f'Service not found: {service}',
                'success': False,
            }

        service_obj = describe_response['services'][0]
        deployments = service_obj.get('deployments', [])

        # Find deployment matching the target task definition
        matching_deployment_from_describe = None
        for deployment in deployments:
            if _task_def_matches(deployment.get('taskDefinition', ''), target_task_definition):
                matching_deployment_from_describe = deployment
                break

        if not matching_deployment_from_describe:
            return {
                'found': False,
                'message': f'No deployment found for task definition: {target_task_definition}',
                'success': False,
            }

        # Extract revision number from service revision ID to match with list_service_deployments
        service_revision_id = matching_deployment_from_describe.get('id', '')
        revision_number = service_revision_id.split('/')[-1] if service_revision_id else None

        # Now get full deployment details from list_service_deployments
        deployments_response = ecs_client.list_service_deployments(
            cluster=cluster,
            service=service
        )

        # Find the deployment by matching the targetServiceRevisionArn
        matching_deployment = None
        for service_deployment in deployments_response.get('serviceDeployments', []):
            target_revision_arn = service_deployment.get('targetServiceRevisionArn', '')
            arn_revision_number = target_revision_arn.split('/')[-1] if target_revision_arn else None

            if revision_number and arn_revision_number == revision_number:
                matching_deployment = service_deployment
                break

        # Fall back to data from describe_services if not found in list_service_deployments
        if not matching_deployment:
            matching_deployment = matching_deployment_from_describe
            rollout_state = matching_deployment.get('rolloutState', 'UNKNOWN')
            status = matching_deployment.get('status', 'UNKNOWN')
            deployment_arn = None
        else:
            # Map status fields from list_service_deployments format
            status_map = {
                'ACTIVE': 'PRIMARY',
                'SUCCESSFUL': 'COMPLETED',
            }
            rollout_state = status_map.get(matching_deployment.get('status', ''),
                                           matching_deployment.get('status', 'UNKNOWN'))
            status = matching_deployment.get('status', 'UNKNOWN')
            deployment_arn = matching_deployment.get('serviceDeploymentArn')

        success = rollout_state == expected_status or status == expected_status

        result = {
            'found': True,
            'taskDefinition': matching_deployment_from_describe.get('taskDefinition'),
            'deploymentArn': deployment_arn,
            'status': status,
            'rolloutState': rollout_state,
            'rolloutStateReason': matching_deployment.get('statusReason',
                                                          matching_deployment_from_describe.get('rolloutStateReason',
                                                                                                '')),
            'desiredCount': matching_deployment_from_describe.get('desiredCount'),
            'runningCount': matching_deployment_from_describe.get('runningCount'),
            'failedTasks': matching_deployment_from_describe.get('failedTasks', 0),
            'createdAt': str(matching_deployment_from_describe.get('createdAt')),
            'updatedAt': str(matching_deployment_from_describe.get('updatedAt')),
            'expectedStatus': expected_status,
            'success': success,
            'message': f"Deployment {status}, rollout state: {rollout_state}"
        }

        return result

    except Exception as e:
        logger.error(f"Failed to check deployment status: {str(e)}")
        raise


def _get_deployment_arns(ecs_client: Any, cluster: str, service: str) -> Dict[str, str]:
    """
    Get deployment ARNs using list_service_deployments API

    Returns a map keyed by targetServiceRevisionArn to deployment ARN
    """
    print(f"::debug::_get_deployment_arns called with cluster={cluster}, service={service}")

    try:
        print(f"::debug::About to call list_service_deployments")
        response = ecs_client.list_service_deployments(
            cluster=cluster,
            service=service
        )

        print(f"::debug::list_service_deployments response keys: {response.keys()}")

        deployments_map = {}
        # Response has 'serviceDeployments' array
        for service_deployment in response.get('serviceDeployments', []):
            deployment_arn = service_deployment.get('serviceDeploymentArn')
            target_revision_arn = service_deployment.get('targetServiceRevisionArn')

            print(
                f"::debug::Processing deployment - deploymentArn: {deployment_arn}, targetRevision: {target_revision_arn}")

            if deployment_arn and target_revision_arn:
                # Extract revision number from targetServiceRevisionArn
                # Format: arn:aws:ecs:region:account:service-revision/cluster/service/revision-number
                revision_number = target_revision_arn.split('/')[-1]
                deployments_map[revision_number] = deployment_arn
                print(f"::debug::Added to map: {revision_number} -> {deployment_arn}")

        print(f"::debug::Final deployments_map: {deployments_map}")
        return deployments_map

    except Exception as e:
        print(f"::error::Exception in _get_deployment_arns: {type(e).__name__}: {str(e)}")
        import traceback
        print(f"::error::Traceback: {traceback.format_exc()}")
        logger.error(f"Failed to get deployment ARNs: {str(e)}")
        return {}


def _task_def_matches(deployment_task_def: str, target_task_def: str) -> bool:
    """
    Check if deployment task definition matches target.

    Supports matching by:
    - Full ARN: arn:aws:ecs:region:account:task-definition/name:revision
    - Family:revision: name:revision
    - Just family: name (matches any revision)
    """
    if not deployment_task_def or not target_task_def:
        return False

    # Extract family:revision from deployment ARN if needed
    if deployment_task_def.startswith('arn:'):
        # arn:aws:ecs:region:account:task-definition/name:revision
        parts = deployment_task_def.split('/')[-1]  # Get "name:revision"
        deployment_family_rev = parts
    else:
        deployment_family_rev = deployment_task_def

    # Normalize target
    if target_task_def.startswith('arn:'):
        target_family_rev = target_task_def.split('/')[-1]
    else:
        target_family_rev = target_task_def

    # Match
    if ':' in target_family_rev:
        # Exact match with revision
        return deployment_family_rev == target_family_rev
    else:
        # Match just the family
        deployment_family = deployment_family_rev.split(':')[0]
        return deployment_family == target_family_rev


def _enrich_deployment(
        deployment: Dict[str, Any],
        cluster: str,
        service: str,
        region: str,
        account_id: str,
        deployment_arns_map: Dict[str, str],
        index: int
) -> Dict[str, Any]:
    """Enrich deployment with additional ARN information"""

    print(f"::debug::_enrich_deployment called, index={index}")

    # The 'id' field is the service revision ID
    service_revision_id = deployment.get('id')

    print(f"::debug::Processing deployment with service_revision_id: {service_revision_id}")

    if service_revision_id:
        # Extract numeric part from "ecs-svc/2533099575141140389"
        revision_number = service_revision_id.split('/')[-1]

        # Construct service revision ARN
        service_revision_arn = f"arn:aws:ecs:{region}:{account_id}:service-revision/{cluster}/{service}/{revision_number}"
        deployment['serviceRevisionArn'] = service_revision_arn

        # Look up deployment ARN by revision number
        print(f"::debug::Looking for revision_number: {revision_number}")
        print(f"::debug::deployment_arns_map keys: {list(deployment_arns_map.keys())}")

        deployment_arn = deployment_arns_map.get(revision_number)
        if deployment_arn:
            print(f"::debug::Found deployment ARN for revision {revision_number}: {deployment_arn}")
        else:
            print(f"::debug::No deployment ARN found for revision {revision_number}")
    else:
        deployment_arn = None

    print(f"::debug::Final deployment_arn: {deployment_arn}")
    deployment['deploymentArn'] = deployment_arn

    return deployment


def _apply_filters(
        deployments: List[Dict[str, Any]],
        filters: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Apply filters to deployments list"""
    filtered = []

    for deployment in deployments:
        # Filter by status
        if 'status' in filters:
            if deployment.get('status') != filters['status']:
                continue

        # Filter by rollout state
        if 'rolloutState' in filters:
            if deployment.get('rolloutState') != filters['rolloutState']:
                continue

        # Filter by minimum running/desired
        if 'minDesired' in filters:
            if deployment.get('desiredCount', 0) < filters['minDesired']:
                continue

        filtered.append(deployment)

    return filtered
