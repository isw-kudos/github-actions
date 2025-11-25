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
