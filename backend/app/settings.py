from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "ncrl-poetic-marker-api"
    version: str = "0.1.0"
    model_config = SettingsConfigDict(env_prefix="NCRL_")


settings = Settings()
