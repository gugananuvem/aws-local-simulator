// Usando com AWS SDK v3
const { ECSClient, RunTaskCommand, ListTasksCommand } = require('@aws-sdk/client-ecs');

const ecs = new ECSClient({
  endpoint: 'http://localhost:8080',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local'
  }
});

// Registrar task definition
await ecs.send(new RegisterTaskDefinitionCommand({
  family: 'my-app',
  containerDefinitions: [
    {
      name: 'web',
      image: 'nginx:alpine',
      cpu: 256,
      memory: 512,
      portMappings: [{ containerPort: 80 }]
    }
  ]
}));

// Executar tarefa
const runTask = await ecs.send(new RunTaskCommand({
  cluster: 'default',
  taskDefinition: 'my-app',
  count: 2
}));

console.log('Tarefas iniciadas:', runTask.tasks);

/*
# Criar cluster
aws ecs create-cluster --cluster-name my-cluster --endpoint-url http://localhost:8080

# Listar clusters
aws ecs list-clusters --endpoint-url http://localhost:8080

# Registrar task definition
aws ecs register-task-definition \
  --family my-app \
  --container-definitions '[
    {
      "name": "web",
      "image": "nginx:alpine",
      "cpu": 256,
      "memory": 512,
      "portMappings": [{"containerPort": 80}]
    }
  ]' \
  --endpoint-url http://localhost:8080

# Executar tarefa
aws ecs run-task \
  --cluster default \
  --task-definition my-app \
  --count 2 \
  --endpoint-url http://localhost:8080

# Listar tarefas
aws ecs list-tasks \
  --cluster default \
  --endpoint-url http://localhost:8080

# Parar tarefa
aws ecs stop-task \
  --cluster default \
  --task <task-arn> \
  --endpoint-url http://localhost:8080

# Criar serviço
aws ecs create-service \
  --cluster default \
  --service-name my-service \
  --task-definition my-app \
  --desired-count 3 \
  --endpoint-url http://localhost:8080

# Atualizar serviço (escalar)
aws ecs update-service \
  --cluster default \
  --service my-service \
  --desired-count 5 \
  --endpoint-url http://localhost:8080
  */