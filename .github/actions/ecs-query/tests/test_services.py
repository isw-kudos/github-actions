from queries.services import get_services, _apply_filters


def test_apply_filters_by_status(sample_services):
    """Test filtering by status"""
    filtered = _apply_filters(sample_services, {'status': 'ACTIVE'})
    assert len(filtered) == 2


def test_apply_filters_by_min_running(sample_services):
    """Test filtering by minimum running count"""
    filtered = _apply_filters(sample_services, {'minRunning': 3})
    assert len(filtered) == 1
    assert filtered[0]['serviceName'] == 'api-service'


def test_apply_filters_by_name_pattern(sample_services):
    """Test filtering by name pattern"""
    filtered = _apply_filters(sample_services, {'namePattern': 'api.*'})
    assert len(filtered) == 1
    assert filtered[0]['serviceName'] == 'api-service'


def test_get_services_calls_ecs_and_filters(mock_ecs_client, sample_services):
    """Ensure get_services calls ECS client correctly and applies filters"""
    # Mock list_services to return ARNs
    mock_ecs_client.list_services.return_value = {
        'serviceArns': [
            'arn:aws:ecs:region:acct:service/cluster/api-service',
            'arn:aws:ecs:region:acct:service/cluster/web-service',
        ]
    }

    # Mock describe_services to return detailed services
    mock_ecs_client.describe_services.return_value = {
        'services': sample_services
    }

    # Call with a filter that only returns api-service
    result = get_services(mock_ecs_client, cluster='my-cluster', filters={'namePattern': '^api-'})

    # Validate calls
    mock_ecs_client.list_services.assert_called_once_with(cluster='my-cluster')
    mock_ecs_client.describe_services.assert_called_once()
    _, kwargs = mock_ecs_client.describe_services.call_args
    assert kwargs['cluster'] == 'my-cluster'
    assert kwargs['services'] == [
        'arn:aws:ecs:region:acct:service/cluster/api-service',
        'arn:aws:ecs:region:acct:service/cluster/web-service',
    ]

    # Validate filtered result
    assert len(result) == 1
    assert result[0]['serviceName'] == 'api-service'


def test_get_services_returns_empty_when_no_arns(mock_ecs_client):
    """When list_services returns no ARNs, we should get an empty list and not call describe_services"""
    mock_ecs_client.list_services.return_value = {'serviceArns': []}

    result = get_services(mock_ecs_client, cluster='empty-cluster')

    assert result == []
    mock_ecs_client.describe_services.assert_not_called()

import pytest
from datetime import datetime
from queries.deployments import check_deployment_status, _task_def_matches


@pytest.fixture
def sample_deployments():
    """Sample deployment data from list_service_deployments"""
    return [
        {
            'arn': 'arn:aws:ecs:ap-southeast-2:872515295541:service-deployment/my-cluster/my-service/deployment-1',
            'taskDefinition': 'arn:aws:ecs:ap-southeast-2:872515295541:task-definition/my-service:100',
            'status': 'ACTIVE',
            'rolloutState': 'COMPLETED',
            'statusReason': 'Deployment completed successfully',
            'desiredCount': 2,
            'runningCount': 2,
            'deployedAndRunningCount': 2,
            'deployedCount': 2,
            'failedTasks': 0,
            'targetServiceRevisionArn': 'arn:aws:ecs:ap-southeast-2:872515295541:service-revision/my-cluster/my-service/9357477342526499124',
            'createdAt': datetime(2025, 11, 30, 22, 18, 55),
            'updatedAt': datetime(2025, 11, 30, 22, 21, 41),
        },
        {
            'arn': 'arn:aws:ecs:ap-southeast-2:872515295541:service-deployment/my-cluster/my-service/deployment-2',
            'taskDefinition': 'arn:aws:ecs:ap-southeast-2:872515295541:task-definition/my-service:99',
            'status': 'ACTIVE',
            'rolloutState': 'IN_PROGRESS',
            'statusReason': 'Deployment in progress',
            'desiredCount': 2,
            'runningCount': 1,
            'deployedAndRunningCount': 1,
            'deployedCount': 2,
            'failedTasks': 0,
            'targetServiceRevisionArn': 'arn:aws:ecs:ap-southeast-2:872515295541:service-revision/my-cluster/my-service/1234567890123456789',
            'createdAt': datetime(2025, 11, 30, 22, 10, 0),
            'updatedAt': datetime(2025, 11, 30, 22, 15, 0),
        },
        {
            'arn': 'arn:aws:ecs:ap-southeast-2:872515295541:service-deployment/my-cluster/my-service/deployment-3',
            'taskDefinition': 'arn:aws:ecs:ap-southeast-2:872515295541:task-definition/my-service:98',
            'status': 'ACTIVE',
            'rolloutState': 'ROLLED_BACK',
            'statusReason': 'Deployment rolled back due to service failures',
            'desiredCount': 2,
            'runningCount': 2,
            'deployedAndRunningCount': 2,
            'deployedCount': 2,
            'failedTasks': 0,
            'targetServiceRevisionArn': 'arn:aws:ecs:ap-southeast-2:872515295541:service-revision/my-cluster/my-service/9876543210987654321',
            'createdAt': datetime(2025, 11, 30, 21, 0, 0),
            'updatedAt': datetime(2025, 11, 30, 21, 5, 0),
        },
    ]


def test_check_deployment_status_success(mock_ecs_client, sample_deployments):
    """Test successful deployment status check"""
    mock_ecs_client.list_service_deployments.return_value = {
        'serviceDeployments': sample_deployments
    }

    result = check_deployment_status(
        mock_ecs_client,
        cluster='my-cluster',
        service='my-service',
        target_task_definition='my-service:100',
        expected_status='COMPLETED'
    )

    assert result['found'] is True
    assert result['success'] is True
    assert result['rolloutState'] == 'COMPLETED'
    assert result['status'] == 'ACTIVE'
    assert result['desiredCount'] == 2
    assert result['runningCount'] == 2
    assert result['deploymentArn'] == 'arn:aws:ecs:ap-southeast-2:872515295541:service-deployment/my-cluster/my-service/deployment-1'


def test_check_deployment_status_in_progress(mock_ecs_client, sample_deployments):
    """Test deployment still in progress"""
    mock_ecs_client.list_service_deployments.return_value = {
        'serviceDeployments': sample_deployments
    }

    result = check_deployment_status(
        mock_ecs_client,
        cluster='my-cluster',
        service='my-service',
        target_task_definition='my-service:99',
        expected_status='COMPLETED'
    )

    assert result['found'] is True
    assert result['success'] is False
    assert result['rolloutState'] == 'IN_PROGRESS'


def test_check_deployment_status_rolled_back(mock_ecs_client, sample_deployments):
    """Test deployment that was rolled back"""
    mock_ecs_client.list_service_deployments.return_value = {
        'serviceDeployments': sample_deployments
    }

    result = check_deployment_status(
        mock_ecs_client,
        cluster='my-cluster',
        service='my-service',
        target_task_definition='my-service:98',
        expected_status='COMPLETED'
    )

    assert result['found'] is True
    assert result['success'] is False
    assert result['rolloutState'] == 'ROLLED_BACK'


def test_check_deployment_status_not_found(mock_ecs_client, sample_deployments):
    """Test when no matching deployment is found"""
    mock_ecs_client.list_service_deployments.return_value = {
        'serviceDeployments': sample_deployments
    }

    result = check_deployment_status(
        mock_ecs_client,
        cluster='my-cluster',
        service='my-service',
        target_task_definition='non-existent-service:999',
        expected_status='COMPLETED'
    )

    assert result['found'] is False
    assert result['success'] is False
    assert 'No deployment found' in result['message']


def test_check_deployment_status_by_arn(mock_ecs_client, sample_deployments):
    """Test matching deployment by full task definition ARN"""
    mock_ecs_client.list_service_deployments.return_value = {
        'serviceDeployments': sample_deployments
    }

    result = check_deployment_status(
        mock_ecs_client,
        cluster='my-cluster',
        service='my-service',
        target_task_definition='arn:aws:ecs:ap-southeast-2:872515295541:task-definition/my-service:100',
        expected_status='COMPLETED'
    )

    assert result['found'] is True
    assert result['success'] is True


def test_task_def_matches_exact_revision():
    """Test task definition matching with exact revision"""
    assert _task_def_matches(
        'arn:aws:ecs:ap-southeast-2:872515295541:task-definition/my-service:100',
        'my-service:100'
    ) is True


def test_task_def_matches_full_arn():
    """Test task definition matching with full ARN"""
    assert _task_def_matches(
        'arn:aws:ecs:ap-southeast-2:872515295541:task-definition/my-service:100',
        'arn:aws:ecs:ap-southeast-2:872515295541:task-definition/my-service:100'
    ) is True


def test_task_def_matches_family_only():
    """Test task definition matching by family only"""
    assert _task_def_matches(
        'arn:aws:ecs:ap-southeast-2:872515295541:task-definition/my-service:100',
        'my-service'
    ) is True


def test_task_def_matches_no_match():
    """Test task definition matching with no match"""
    assert _task_def_matches(
        'arn:aws:ecs:ap-southeast-2:872515295541:task-definition/my-service:100',
        'other-service:100'
    ) is False


def test_check_deployment_status_calls_correct_api(mock_ecs_client, sample_deployments):
    """Ensure check_deployment_status calls list_service_deployments"""
    mock_ecs_client.list_service_deployments.return_value = {
        'serviceDeployments': sample_deployments
    }

    check_deployment_status(
        mock_ecs_client,
        cluster='my-cluster',
        service='my-service',
        target_task_definition='my-service:100'
    )

    mock_ecs_client.list_service_deployments.assert_called_once_with(
        cluster='my-cluster',
        service='my-service'
    )
