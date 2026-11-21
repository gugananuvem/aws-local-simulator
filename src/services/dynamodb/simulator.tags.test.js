const fs = require("fs");
const os = require("os");
const path = require("path");
const DynamoDBSimulator = require("./simulator");

describe("DynamoDB table tags", () => {
  let dataDir;
  let simulator;
  const resourceArn = "arn:aws:dynamodb:us-east-1:000000000000:table/tagged";

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dynamodb-tags-"));
    simulator = new DynamoDBSimulator({ dataDir });
    simulator.createTable({
      TableName: "tagged",
      KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
      AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
      Tags: [{ Key: "env", Value: "dev" }],
    });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test("lists and updates table tags through DynamoDB API actions", async () => {
    await simulator.handleRequest("DynamoDB_20120810.TagResource", {
      ResourceArn: resourceArn,
      Tags: [{ Key: "env", Value: "prod" }, { Key: "team", Value: "platform" }],
    });

    expect(await simulator.handleRequest("DynamoDB_20120810.ListTagsOfResource", {
      ResourceArn: resourceArn,
    })).toEqual({
      Tags: [{ Key: "env", Value: "prod" }, { Key: "team", Value: "platform" }],
    });

    await simulator.handleRequest("DynamoDB_20120810.UntagResource", {
      ResourceArn: resourceArn,
      TagKeys: ["team"],
    });

    expect(simulator.getTableTags("tagged")).toEqual([{ Key: "env", Value: "prod" }]);
  });

  test("persists tags with table metadata", async () => {
    await simulator.handleRequest("DynamoDB_20120810.TagResource", {
      ResourceArn: resourceArn,
      Tags: [{ Key: "owner", Value: "data" }],
    });

    const reloadedSimulator = new DynamoDBSimulator({ dataDir });
    reloadedSimulator.loadTables();

    expect(reloadedSimulator.getTableTags("tagged")).toEqual([
      { Key: "env", Value: "dev" },
      { Key: "owner", Value: "data" },
    ]);
  });
});
