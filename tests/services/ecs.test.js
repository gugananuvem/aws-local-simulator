/**
 * Integração com o ECS pelo AWS SDK v3.
 *
 * Só roda quando há um servidor ECS em ECS_ENDPOINT (ex.: http://localhost:8080). Sem essa
 * variável, a suíte fica como "skipped". O serviço ECS vem desligado por padrão.
 *
 * Equivalente em CLI (com o servidor rodando):
 *   aws ecs create-cluster --cluster-name my-cluster --endpoint-url http://localhost:8080
 *   aws ecs run-task --cluster default --task-definition my-app --count 2 --endpoint-url http://localhost:8080
 */
const {
  ECSClient,
  RegisterTaskDefinitionCommand,
  RunTaskCommand,
  ListTasksCommand,
} = require('@aws-sdk/client-ecs');

const ENDPOINT = process.env.ECS_ENDPOINT;
const describeIfEcs = ENDPOINT ? describe : describe.skip;

describeIfEcs('ECS (servidor externo em ECS_ENDPOINT)', () => {
  const ecs = new ECSClient({
    endpoint: ENDPOINT,
    region: 'us-east-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });

  test('registra uma task definition e executa tarefas', async () => {
    await ecs.send(new RegisterTaskDefinitionCommand({
      family: 'my-app',
      containerDefinitions: [
        {
          name: 'web',
          image: 'nginx:alpine',
          cpu: 256,
          memory: 512,
          portMappings: [{ containerPort: 80 }],
        },
      ],
    }));

    const run = await ecs.send(new RunTaskCommand({
      cluster: 'default',
      taskDefinition: 'my-app',
      count: 2,
    }));
    expect(run.tasks).toHaveLength(2);

    const list = await ecs.send(new ListTasksCommand({ cluster: 'default' }));
    expect(list.taskArns.length).toBeGreaterThanOrEqual(2);
  });
});
