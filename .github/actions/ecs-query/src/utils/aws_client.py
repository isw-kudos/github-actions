import boto3
import logging

logger = logging.getLogger(__name__)


def get_ecs_client(region: str = 'eu-west-1'):
    """
    Initialize and return ECS client
    Uses credentials from environment (GitHub Actions OIDC)
    """
    try:
        client = boto3.client('ecs', region_name=region)
        logger.info(f"Connected to ECS in region: {region}")
        return client
    except Exception as e:
        logger.error(f"Failed to create ECS client: {str(e)}")
        raise
