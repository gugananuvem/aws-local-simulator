# EC2 Query Protocol Support

## Overview

The AWS Local Simulator now includes full support for the **EC2 Query Protocol**, which enables AWS CLI commands to work seamlessly with the VPC service. This means you can use standard `aws ec2` commands directly against the local simulator without needing to use custom admin endpoints.

## What is EC2 Query Protocol?

EC2 Query Protocol is a REST-style API protocol that AWS EC2 (and related services like VPC) use. When you run `aws ec2 describe-vpcs`, the AWS CLI sends a POST request with EC2 Query parameters and expects an XML response.

### How It Works

1. **AWS CLI** → sends `POST /` with `Action=DescribeVpcs` parameter
2. **VPC Server** → converts the action to internal handler
3. **Handler** → calls simulator, converts response to EC2 XML format
4. **XML Response** → AWS CLI automatically converts to JSON for display

## Supported EC2 Commands (VPC Service)

The following EC2 commands are now fully supported against the VPC simulator:

### VPCs

```bash
# List VPCs
aws ec2 describe-vpcs --endpoint-url http://localhost:4014

# List specific VPC
aws ec2 describe-vpcs --vpc-ids vpc-xxxxx --endpoint-url http://localhost:4014

# Create VPC
aws ec2 create-vpc --cidr-block 10.0.0.0/16 --endpoint-url http://localhost:4014

# Delete VPC
aws ec2 delete-vpc --vpc-id vpc-xxxxx --endpoint-url http://localhost:4014
```

### Subnets

```bash
# List all subnets
aws ec2 describe-subnets --endpoint-url http://localhost:4014

# List subnets in specific VPC
aws ec2 describe-subnets --filters "Name=vpc-id,Values=vpc-xxxxx" --endpoint-url http://localhost:4014

# Create subnet
aws ec2 create-subnet \
  --vpc-id vpc-xxxxx \
  --cidr-block 10.0.1.0/24 \
  --availability-zone us-east-1a \
  --endpoint-url http://localhost:4014

# Delete subnet
aws ec2 delete-subnet --subnet-id subnet-xxxxx --endpoint-url http://localhost:4014
```

### Internet Gateways

```bash
# List Internet Gateways
aws ec2 describe-internet-gateways --endpoint-url http://localhost:4014

# Create Internet Gateway
aws ec2 create-internet-gateway --endpoint-url http://localhost:4014

# Attach Internet Gateway to VPC
aws ec2 attach-internet-gateway \
  --internet-gateway-id igw-xxxxx \
  --vpc-id vpc-xxxxx \
  --endpoint-url http://localhost:4014

# Detach Internet Gateway from VPC
aws ec2 detach-internet-gateway \
  --internet-gateway-id igw-xxxxx \
  --vpc-id vpc-xxxxx \
  --endpoint-url http://localhost:4014

# Delete Internet Gateway
aws ec2 delete-internet-gateway --internet-gateway-id igw-xxxxx --endpoint-url http://localhost:4014
```

### Route Tables

```bash
# List Route Tables
aws ec2 describe-route-tables --endpoint-url http://localhost:4014

# List route tables in specific VPC
aws ec2 describe-route-tables --filters "Name=vpc-id,Values=vpc-xxxxx" --endpoint-url http://localhost:4014

# Create Route Table
aws ec2 create-route-table --vpc-id vpc-xxxxx --endpoint-url http://localhost:4014

# Create route (default route to IGW)
aws ec2 create-route \
  --route-table-id rtb-xxxxx \
  --destination-cidr-block 0.0.0.0/0 \
  --gateway-id igw-xxxxx \
  --endpoint-url http://localhost:4014

# Delete Route Table
aws ec2 delete-route-table --route-table-id rtb-xxxxx --endpoint-url http://localhost:4014
```

## Complete Example: Create a VPC with Public Subnet

Here's a complete example that creates a VPC, subnet, internet gateway, and route table:

```bash
#!/bin/bash

ENDPOINT="http://localhost:4014"

# 1. Create VPC
echo "Creating VPC..."
VPC_OUTPUT=$(aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --endpoint-url $ENDPOINT)
VPC_ID=$(echo $VPC_OUTPUT | jq -r '.Vpc.VpcId')
echo "VPC created: $VPC_ID"

# 2. Create Subnet
echo "Creating subnet..."
SUBNET_OUTPUT=$(aws ec2 create-subnet \
  --vpc-id $VPC_ID \
  --cidr-block 10.0.1.0/24 \
  --availability-zone us-east-1a \
  --endpoint-url $ENDPOINT)
SUBNET_ID=$(echo $SUBNET_OUTPUT | jq -r '.Subnet.SubnetId')
echo "Subnet created: $SUBNET_ID"

# 3. Create Internet Gateway
echo "Creating Internet Gateway..."
IGW_OUTPUT=$(aws ec2 create-internet-gateway \
  --endpoint-url $ENDPOINT)
IGW_ID=$(echo $IGW_OUTPUT | jq -r '.InternetGateway.InternetGatewayId')
echo "Internet Gateway created: $IGW_ID"

# 4. Attach IGW to VPC
echo "Attaching Internet Gateway to VPC..."
aws ec2 attach-internet-gateway \
  --internet-gateway-id $IGW_ID \
  --vpc-id $VPC_ID \
  --endpoint-url $ENDPOINT
echo "Attached!"

# 5. Create Route Table
echo "Creating Route Table..."
RT_OUTPUT=$(aws ec2 create-route-table \
  --vpc-id $VPC_ID \
  --endpoint-url $ENDPOINT)
RT_ID=$(echo $RT_OUTPUT | jq -r '.RouteTable.RouteTableId')
echo "Route Table created: $RT_ID"

# 6. Create default route to IGW
echo "Creating default route to Internet Gateway..."
aws ec2 create-route \
  --route-table-id $RT_ID \
  --destination-cidr-block 0.0.0.0/0 \
  --gateway-id $IGW_ID \
  --endpoint-url $ENDPOINT
echo "Route created!"

# 7. Verify everything
echo ""
echo "=== Verification ==="
echo "VPCs:"
aws ec2 describe-vpcs --endpoint-url $ENDPOINT | jq '.Vpcs[] | {VpcId, CidrBlock, State}'

echo ""
echo "Subnets:"
aws ec2 describe-subnets --endpoint-url $ENDPOINT | jq '.Subnets[] | {SubnetId, VpcId, CidrBlock}'

echo ""
echo "Internet Gateways:"
aws ec2 describe-internet-gateways --endpoint-url $ENDPOINT | jq '.InternetGateways[] | {InternetGatewayId, Attachments}'

echo ""
echo "Route Tables:"
aws ec2 describe-route-tables --endpoint-url $ENDPOINT | jq '.RouteTables[] | {RouteTableId, VpcId, Routes}'
```

## Using Environment Variables

To avoid repeating `--endpoint-url` in every command, you can set an environment variable:

```bash
# Using environment variable
export AWS_ENDPOINT_URL_EC2=http://localhost:4014

# Now all commands will use the local simulator
aws ec2 describe-vpcs
aws ec2 create-vpc --cidr-block 10.0.0.0/16
aws ec2 describe-subnets
```

## XML Response Format

Internally, the VPC service returns responses in EC2 XML format. The `EC2ResponseFormatter` class handles the conversion from internal JSON format to AWS-compatible XML. Example:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<DescribeVpcsResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">
  <requestId>vpc-request-1</requestId>
  <vpcSet>
    <item>
      <vpcId>vpc-d9857d00</vpcId>
      <state>available</state>
      <cidrBlock>10.0.0.0/16</cidrBlock>
      <dhcpOptionsId>dopt-default</dhcpOptionsId>
      <tagSet />
      <isDefault>false</isDefault>
    </item>
  </vpcSet>
</DescribeVpcsResponse>
```

The AWS CLI automatically converts this XML response to JSON for display:

```json
{
  "Vpcs": [
    {
      "VpcId": "vpc-d9857d00",
      "CidrBlock": "10.0.0.0/16",
      "State": "available",
      "DhcpOptionsId": "dopt-default",
      "Tags": [],
      "IsDefault": false
    }
  ]
}
```

## Supported EC2 Actions

The VPC service implements the following EC2 Query Protocol actions:

| Action | Handler | Status |
|--------|---------|--------|
| DescribeVpcs | `_handleDescribeVpcs` | ✅ |
| CreateVpc | `_handleCreateVpc` | ✅ |
| DeleteVpc | `_handleDeleteVpc` | ✅ |
| DescribeSubnets | `_handleDescribeSubnets` | ✅ |
| CreateSubnet | `_handleCreateSubnet` | ✅ |
| DeleteSubnet | `_handleDeleteSubnet` | ✅ |
| DescribeInternetGateways | `_handleDescribeIgws` | ✅ |
| CreateInternetGateway | `_handleCreateIgw` | ✅ |
| AttachInternetGateway | `_handleAttachIgw` | ✅ |
| DetachInternetGateway | `_handleDetachIgw` | ✅ |
| DeleteInternetGateway | `_handleDeleteIgw` | ✅ |
| DescribeRouteTables | `_handleDescribeRouteTables` | ✅ |
| CreateRouteTable | `_handleCreateRouteTable` | ✅ |
| CreateRoute | `_handleCreateRoute` | ✅ |
| DeleteRouteTable | `_handleDeleteRouteTable` | ✅ |

## Technical Details

### Architecture

```
┌─────────────────────────────────────────┐
│ AWS CLI (standard ec2 commands)         │
└───────────────────┬─────────────────────┘
                    │
                    │ EC2 Query Protocol
                    │ (JSON Action=DescribeVpcs)
                    ▼
        ┌───────────────────────┐
        │   VPC Server          │
        │   (Express.js)        │
        └───────────┬───────────┘
                    │
           ┌────────┴────────┐
           │                 │
        POST /           GET /__admin/*
    (EC2 Protocol)        (REST API)
           │                 │
           ▼                 ▼
    ┌──────────────────────────────┐
    │ VPCSimulator                 │
    │ - createVPC()                │
    │ - describeVPCs()             │
    │ - createSubnet()             │
    │ etc.                         │
    └──────────────────────────────┘
           │
           │ .toJSON()
           ▼
    ┌──────────────────────────────┐
    │ EC2ResponseFormatter         │
    │ - formatDescribeVpcsResponse │
    │ - formatCreateVpcResponse    │
    │ etc.                         │
    └──────────────────────────────┘
           │
           │ XML
           ▼
    ┌──────────────────────────────┐
    │ HTTP Response (text/xml)     │
    │ (AWS CLI converts to JSON)   │
    └──────────────────────────────┘
```

### Request Flow

1. **AWS CLI sends**: `POST / HTTP/1.1` with body `Action=DescribeVpcs&Version=2016-11-15`
2. **VPC Server receives**: Express middleware parses JSON body
3. **Route Handler**: `app.post('/')` catches the request
4. **Action Dispatcher**: Switch statement routes to handler method
5. **Handler Execution**: `_handleDescribeVpcs()` calls simulator
6. **Response Formatting**: `EC2ResponseFormatter.formatDescribeVpcsResponse()`
7. **XML Response**: Express sends XML with `Content-Type: text/xml`
8. **AWS CLI Parsing**: AWS CLI converts XML to JSON and displays

### Adding New EC2 Actions

To add support for a new EC2 action:

1. **Add handler method** in `VPCServer` class (e.g., `_handleNewAction`)
2. **Add formatter method** in `EC2ResponseFormatter` class (e.g., `formatNewActionResponse`)
3. **Add case** in `POST /` switch statement to route to handler

Example:

```javascript
// In VPCServer.setupRoutes()
case 'NewAction':
  return this._handleNewAction(req, res);

// Handler method
_handleNewAction(req, res) {
  try {
    // Call simulator
    const result = this.simulator.newAction(req.body.Param);
    // Format response
    const xmlResponse = EC2ResponseFormatter.formatNewActionResponse(result);
    res.set('Content-Type', 'text/xml');
    res.send(xmlResponse);
  } catch (error) {
    const xmlError = EC2ResponseFormatter.formatErrorResponse('InternalError', error.message);
    res.status(400).set('Content-Type', 'text/xml').send(xmlError);
  }
}
```

## Backward Compatibility

The VPC service maintains backward compatibility with the admin REST API endpoints (`/__admin/*`). You can continue using:

- `curl http://localhost:4014/__admin/vpcs` (still works)
- AWS CLI via EC2 Query Protocol (new feature)

Choose the approach that best fits your use case:

- **Admin Endpoints**: Good for testing, debugging, direct API calls
- **AWS CLI + EC2 Query**: Proper AWS API, compatible with AWS CLI, script automation

## Error Handling

The EC2 Query Protocol properly handles errors by returning XML error responses:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Errors>
    <Error>
      <Code>InternalError</Code>
      <Message>VPC vpc-xxxxx not found</Message>
    </Error>
  </Errors>
  <RequestId>vpc-request-1</RequestId>
</Response>
```

AWS CLI displays these errors appropriately:

```bash
$ aws ec2 delete-vpc --vpc-id vpc-invalid --endpoint-url http://localhost:4014
An error occurred (InternalError) when calling the DeleteVpc operation: VPC vpc-invalid not found
```

## References

- [AWS EC2 Query Protocol Documentation](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/Query-Requests.html)
- [EC2 API Reference](https://docs.aws.amazon.com/AWSEC2/latest/APIReference/Welcome.html)
- [AWS CLI EC2 Commands](https://docs.aws.amazon.com/cli/latest/reference/ec2/index.html)
