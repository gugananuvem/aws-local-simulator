"""Bootstrap Python do AWS Local Simulator (um processo por invocação).

Lê JSON { handler, event, context } do stdin, importa o módulo do handler a
partir de AWS_LOCAL_SIM_CODE_PATH (ou cwd), chama a função (sync ou async) e
escreve o resultado/erro no stdout entre marcadores únicos.
"""
import asyncio
import inspect
import importlib
import json
import os
import sys
import time
import traceback


class LambdaContext(object):
    def __init__(self, data):
        self.aws_request_id = data.get("awsRequestId")
        self.function_name = data.get("functionName")
        self.function_version = data.get("functionVersion")
        self.invoked_function_arn = data.get("invokedFunctionArn")
        self.memory_limit_in_mb = data.get("memoryLimitInMB")
        self.log_group_name = data.get("logGroupName")
        self.log_stream_name = data.get("logStreamName")
        self.identity = None
        self.client_context = None
        self._deadline_ms = data.get("deadlineMs")

    def get_remaining_time_in_millis(self):
        if self._deadline_ms is None:
            return 0
        return max(0, int(self._deadline_ms - time.time() * 1000))


def _emit(out, marker, kind, payload):
    out.flush()
    out.write("\n%s:%s:BEGIN%s%s:%s:END\n" % (marker, kind, payload, marker, kind))
    out.flush()


def _emit_error(out, marker, exc):
    tb = traceback.format_exception(type(exc), exc, exc.__traceback__)
    info = {
        "errorType": type(exc).__name__,
        "errorMessage": str(exc),
        "stackTrace": [line.rstrip("\n") for line in tb],
    }
    _emit(out, marker, "ERROR", json.dumps(info, default=str))


async def _await(awaitable):
    return await awaitable


def main():
    marker = os.environ.get("AWS_LOCAL_SIM_MARKER", "__AWSLOCALSIM__")
    out = sys.stdout
    try:
        raw = sys.stdin.buffer.read().decode("utf-8")
        payload = json.loads(raw)
        handler = payload["handler"]
        event = payload.get("event")
        context = LambdaContext(payload.get("context") or {})

        code_path = os.environ.get("AWS_LOCAL_SIM_CODE_PATH") or os.getcwd()
        # Remove o diretório do bootstrap do sys.path e prioriza o código do usuário
        if sys.path and os.path.abspath(sys.path[0]) == os.path.dirname(os.path.abspath(__file__)):
            sys.path.pop(0)
        sys.path.insert(0, code_path)

        module_name, _, fn_name = handler.rpartition(".")
        module = importlib.import_module(module_name.replace("/", "."))
        fn = getattr(module, fn_name)

        result = fn(event, context)
        if inspect.isawaitable(result):
            result = asyncio.run(_await(result))

        _emit(out, marker, "RESULT", json.dumps(result, default=str))
    except BaseException as exc:  # inclui SystemExit/KeyboardInterrupt
        try:
            _emit_error(out, marker, exc)
        finally:
            sys.exit(1)


if __name__ == "__main__":
    main()
