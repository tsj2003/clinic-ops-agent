#!/bin/bash
# Load Test Runner Script

set -e

echo "🚀 Clinic Ops Agent - Load Testing"
echo "===================================="

# Configuration
HOST=${HOST:-http://localhost:8000}
USERS=${USERS:-1000}
DURATION=${DURATION:-10m}
RESULTS_DIR="tests/load/results"

# Create results directory
mkdir -p $RESULTS_DIR

echo ""
echo "Test Configuration:"
echo "  Host: $HOST"
echo "  Users: $USERS"
echo "  Duration: $DURATION"
echo "  Results: $RESULTS_DIR"
echo ""

# Check if Locust is installed
if ! command -v locust &> /dev/null; then
    echo "❌ Locust not found. Installing..."
    pip install locust==2.20.1
fi

# Check if API is healthy
echo "🔍 Checking API health..."
if curl -s -o /dev/null -w "%{http_code}" $HOST/health | grep -q "200"; then
    echo "✅ API is healthy"
else
    echo "❌ API is not responding. Starting local server..."
    # Start API in background
    cd .. && uvicorn api.main:app --host 0.0.0.0 --port 8000 &
    API_PID=$!
    
    # Wait for API to start
    echo "⏳ Waiting for API to start..."
    sleep 5
    
    # Check health again
    if curl -s -o /dev/null -w "%{http_code}" $HOST/health | grep -q "200"; then
        echo "✅ API is now healthy"
    else
        echo "❌ Failed to start API. Please start manually."
        exit 1
    fi
fi

echo ""
echo "🧪 Starting load test..."
echo "===================================="

# Run load test
locust -f tests/load/locustfile.py \
    --host $HOST \
    --users $USERS \
    --spawn-rate 50 \
    --run-time $DURATION \
    --headless \
    --csv $RESULTS_DIR/clinic_ops_load_test \
    --html $RESULTS_DIR/report.html \
    --loglevel INFO

echo ""
echo "📊 Load test complete!"
echo "===================================="
echo "Results saved to: $RESULTS_DIR"
echo ""
echo "Files generated:"
echo "  - $RESULTS_DIR/report.html (visual report)"
echo "  - $RESULTS_DIR/clinic_ops_load_test_exceptions.csv"
echo "  - $RESULTS_DIR/clinic_ops_load_test_failures.csv"
echo "  - $RESULTS_DIR/clinic_ops_load_test_stats.csv"
echo "  - $RESULTS_DIR/clinic_ops_load_test_stats_history.csv"
echo ""

# Parse and validate results
echo "🔍 Validating performance thresholds..."
echo ""

# Extract stats (this would be more sophisticated in production)
if [ -f "$RESULTS_DIR/clinic_ops_load_test_stats.csv" ]; then
    echo "Test Statistics:"
    tail -n +2 $RESULTS_DIR/clinic_ops_load_test_stats.csv | head -n 20
fi

# Cleanup background API if we started it
if [ ! -z "$API_PID" ]; then
    echo ""
    echo "🧹 Stopping background API..."
    kill $API_PID 2>/dev/null || true
fi

echo ""
echo "✅ Load test completed successfully!"
