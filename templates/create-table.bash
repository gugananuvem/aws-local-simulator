aws dynamodb create-table \
    --cli-input-json file://table-definition.json \
    --endpoint-url http://localhost:8000


aws dynamodb batch-write-item --cli-input-json file://seed-data.json --endpoint-url http://localhost:8000


aws dynamodb update-item --cli-input-json file://update-user-1.json --endpoint-url http://localhost:8000

aws dynamodb update-item --cli-input-json file://update-user-2.json --endpoint-url http://localhost:8000


aws dynamodb query --cli-input-json file://query-user.json --endpoint-url http://localhost:8000