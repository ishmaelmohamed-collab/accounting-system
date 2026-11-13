#!/bin/sh
set -e

echo "Applying Django migrations..."
python manage.py migrate --noinput

echo "Collecting static files..."
python manage.py collectstatic --noinput

echo "Starting gunicorn..."
exec gunicorn accounting_project.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 3 \
    --timeout 120
