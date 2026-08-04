import os, subprocess
URL=os.getenv("NCRL_TEST_POSTGRES_URL")
def test_0001_to_0002_cancel_requested_roundtrip():
    if not URL:
        import pytest
        pytest.skip("requires disposable PostgreSQL database")
    import psycopg
    env={**os.environ,"NCRL_DATABASE_URL":URL}
    cwd="backend" if os.path.isdir("backend") else "."
    subprocess.run(["alembic","downgrade","base"],cwd=cwd,env=env,check=True)
    subprocess.run(["alembic","upgrade","0001"],cwd=cwd,env=env,check=True)
    subprocess.run(["alembic","upgrade","0002_pdf_sources"],cwd=cwd,env=env,check=True)
    with psycopg.connect(URL.replace("postgresql+psycopg://","postgresql://")) as connection:
        with connection.cursor() as cursor:
            cursor.execute("INSERT INTO projects(id,name,schema_version,workspace,revision,created_at,updated_at) VALUES(gen_random_uuid(),'migration',1,'{}',1,now(),now()) RETURNING id"); project=cursor.fetchone()[0]
            cursor.execute("INSERT INTO jobs(id,project_id,type,status,progress,attempts,created_at,updated_at) VALUES(gen_random_uuid(),%s,'pdf_extract','cancel_requested',0,1,now(),now()) RETURNING status",(project,))
            assert cursor.fetchone()[0]=="cancel_requested"
    subprocess.run(["alembic","downgrade","0001"],cwd=cwd,env=env,check=True)
    subprocess.run(["alembic","upgrade","head"],cwd=cwd,env=env,check=True)

if __name__ == "__main__":
    if not URL: raise SystemExit("NCRL_TEST_POSTGRES_URL is required")
    test_0001_to_0002_cancel_requested_roundtrip()
