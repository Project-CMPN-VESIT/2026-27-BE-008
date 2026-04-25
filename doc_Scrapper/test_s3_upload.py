"""Test S3 upload."""
import os
import boto3
from pathlib import Path

# Load from .env
env_file = Path(".env")
if env_file.exists():
    for line in env_file.read_text().strip().split("\n"):
        if "=" in line:
            key, val = line.split("=", 1)
            os.environ[key.strip()] = val.strip().strip('"')

s3 = boto3.client("s3", region_name=os.getenv("AWS_DEFAULT_REGION"))
bucket = os.getenv("S3_BUCKET")

print(f"Bucket: {bucket}")
print(f"Region: {os.getenv('AWS_DEFAULT_REGION')}")

if not bucket:
    print("❌ S3_BUCKET not set in .env")
    exit(1)

# Test: upload the summary file
try:
    s3.upload_file(
        r"output\RELIANCE\RELIANCE_summary.txt",
        bucket,
        "test/RELIANCE_summary.txt"
    )
    print(f"✅ Uploaded to s3://{bucket}/test/RELIANCE_summary.txt")
except Exception as e:
    print(f"❌ Error: {e}")
