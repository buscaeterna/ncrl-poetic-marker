from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "ncrl-poetic-marker-api"
    version: str = "0.1.0"
    database_url: str = "sqlite:///./ncrl.db"
    max_workspace_bytes: int = 20 * 1024 * 1024
    worker_poll_seconds: float = 1.0
    job_lease_seconds: int = 300
    job_max_attempts: int = 3
    model_config = SettingsConfigDict(env_prefix="NCRL_")


settings = Settings()
