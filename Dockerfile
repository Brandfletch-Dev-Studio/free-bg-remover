FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1-mesa-glx libgomp1

WORKDIR /app

# Install in small batches to reduce peak memory on Render free tier
COPY server/requirements.txt .
RUN pip install --no-cache-dir fastapi==0.115.0 uvicorn[standard]==0.30.6 python-multipart==0.0.9 Pillow==10.4.0 numpy==1.26.4
RUN pip install --no-cache-dir onnxruntime==1.19.2
RUN pip install --no-cache-dir rembg==2.0.59

COPY server/ .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
