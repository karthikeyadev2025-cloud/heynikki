#!/usr/bin/env bash
# Install + configure CloudWatch Agent on Ubuntu 24 EC2.
#
# Prerequisites:
#   1. Attach an IAM role to this EC2 instance with the AWS-managed policy:
#        CloudWatchAgentServerPolicy
#      (EC2 Console → Instance → Actions → Security → Modify IAM role)
#   2. Run this script with sudo.

set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "▶ Installing CloudWatch Agent (region: $REGION)…"

# Download official CloudWatch Agent .deb for Ubuntu amd64
cd /tmp
wget -q "https://s3.${REGION}.amazonaws.com/amazoncloudwatch-agent-${REGION}/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb"
sudo dpkg -i -E amazon-cloudwatch-agent.deb
rm -f amazon-cloudwatch-agent.deb

echo "▶ Installing Hey Nikki CloudWatch config…"
sudo cp "$REPO_ROOT/infra/aws/cloudwatch-agent.json" \
        /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

echo "▶ Starting agent with config…"
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -s \
    -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json

echo "▶ Enabling on boot…"
sudo systemctl enable amazon-cloudwatch-agent

echo ""
echo "✓ CloudWatch Agent installed."
echo ""
echo "Verify status:"
echo "   sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status"
echo ""
echo "Logs will appear in CloudWatch under log groups starting with /heynikki/"
echo "Metrics will appear in CloudWatch → Metrics → HeyNikki/EC2"
