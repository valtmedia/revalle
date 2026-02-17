#!/bin/bash
# ===========================================
# Node Agent - Log Forwarder
# Forwards squid access logs to control plane
# ===========================================

CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-http://localhost:3000}"
ACCESS_LOG="/var/log/squid/access.log"
STATE_FILE="/tmp/log_forwarder_offset"

NODE_ID_FILE="/tmp/node_id"
if [ ! -f "$NODE_ID_FILE" ]; then
    exit 0
fi
NODE_ID=$(cat "$NODE_ID_FILE")

# Track last read position
LAST_OFFSET=0
if [ -f "$STATE_FILE" ]; then
    LAST_OFFSET=$(cat "$STATE_FILE")
fi

# Check if log file exists
if [ ! -f "$ACCESS_LOG" ]; then
    exit 0
fi

# Get current file size
CURRENT_SIZE=$(stat -c %s "$ACCESS_LOG" 2>/dev/null || echo 0)

# If file was rotated (size decreased), reset
if [ "$CURRENT_SIZE" -lt "$LAST_OFFSET" ]; then
    LAST_OFFSET=0
fi

# Read new lines
NEW_LINES=$(tail -c +$((LAST_OFFSET + 1)) "$ACCESS_LOG" 2>/dev/null | head -100)

if [ -z "$NEW_LINES" ]; then
    exit 0
fi

# Count entries
LINE_COUNT=$(echo "$NEW_LINES" | wc -l)

# Parse and aggregate log entries
TOTAL_BYTES=0
TOTAL_REQUESTS=0
ERRORS=0
STATUS_200=0
STATUS_301=0
STATUS_302=0
STATUS_403=0
STATUS_404=0
STATUS_500=0
STATUS_502=0
STATUS_503=0
TCP_HIT=0
TCP_MISS=0
TCP_DENIED=0

while IFS= read -r line; do
    TOTAL_REQUESTS=$((TOTAL_REQUESTS + 1))
    
    # Parse squid access log format
    BYTES=$(echo "$line" | awk '{print $5}')
    STATUS=$(echo "$line" | awk '{print $4}' | cut -d/ -f2)
    RESULT=$(echo "$line" | awk '{print $4}' | cut -d/ -f1)
    
    TOTAL_BYTES=$((TOTAL_BYTES + ${BYTES:-0}))
    
    case "$STATUS" in
        200) STATUS_200=$((STATUS_200 + 1)) ;;
        301) STATUS_301=$((STATUS_301 + 1)) ;;
        302) STATUS_302=$((STATUS_302 + 1)) ;;
        403) STATUS_403=$((STATUS_403 + 1)) ;;
        404) STATUS_404=$((STATUS_404 + 1)) ;;
        500) STATUS_500=$((STATUS_500 + 1)); ERRORS=$((ERRORS + 1)) ;;
        502) STATUS_502=$((STATUS_502 + 1)); ERRORS=$((ERRORS + 1)) ;;
        503) STATUS_503=$((STATUS_503 + 1)); ERRORS=$((ERRORS + 1)) ;;
    esac
    
    case "$RESULT" in
        TCP_HIT*) TCP_HIT=$((TCP_HIT + 1)) ;;
        TCP_MISS*) TCP_MISS=$((TCP_MISS + 1)) ;;
        TCP_DENIED*) TCP_DENIED=$((TCP_DENIED + 1)) ;;
    esac
done <<< "$NEW_LINES"

# Send aggregated stats
curl -sf --max-time 10 \
    -X POST "$CONTROL_PLANE_URL/api/nodes/$NODE_ID/logs" \
    -H "Content-Type: application/json" \
    -d "{
        \"period\": \"1m\",
        \"timestamp\": \"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\",
        \"summary\": {
            \"totalRequests\": $TOTAL_REQUESTS,
            \"totalBytes\": $TOTAL_BYTES,
            \"errors\": $ERRORS,
            \"statusCodes\": {
                \"200\": $STATUS_200,
                \"301\": $STATUS_301,
                \"302\": $STATUS_302,
                \"403\": $STATUS_403,
                \"404\": $STATUS_404,
                \"500\": $STATUS_500,
                \"502\": $STATUS_502,
                \"503\": $STATUS_503
            },
            \"cacheResults\": {
                \"hit\": $TCP_HIT,
                \"miss\": $TCP_MISS,
                \"denied\": $TCP_DENIED
            }
        }
    }" 2>/dev/null

# Update offset
echo "$CURRENT_SIZE" > "$STATE_FILE"
