FROM python:3.14-slim

WORKDIR /action

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY src/ /src/

ENTRYPOINT ["python", "/src/main.py"]
