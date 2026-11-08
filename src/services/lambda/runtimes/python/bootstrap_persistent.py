"""Bootstrap Python PERSISTENTE do AWS Local Simulator (um worker por Lambda).

Diferente de bootstrap.py (um processo por invocação), este processo:
  1. (opcional) abre o debugpy numa porta, ANTES de importar o handler;
  2. importa o módulo do handler UMA vez (fase de init);
  3. emite <MARKER>:READY:BEGIN{}<MARKER>:READY:END;
  4. lê o stdin, UMA LINHA por invocação: {"id": "...", "event": ..., "context": ...};
  5. responde com <MARKER>:RESULT:<id>:BEGIN<json><MARKER>:RESULT:<id>:END
     (ou <MARKER>:ERROR:<id>:BEGIN{errorType,errorMessage,stackTrace}...END);
  6. termina quando o stdin fecha (EOF).

Falha no init: bloco <MARKER>:ERROR:init:BEGIN...END e saída com código 1.
Erro do handler NÃO encerra o worker.

Variáveis de ambiente:
  AWS_LOCAL_SIM_MARKER      prefixo único do worker
  AWS_LOCAL_SIM_CODE_PATH   diretório do código
  AWS_LOCAL_SIM_HANDLER     handler 'modulo.funcao'
  AWS_LOCAL_SIM_DEBUG_PORT  se definida, ativa debugpy.listen
  AWS_LOCAL_SIM_DEBUG_HOST  host do debugpy (padrão 127.0.0.1)
  AWS_LOCAL_SIM_DEBUG_WAIT  "1" => debugpy.wait_for_client()
"""
import asyncio
import importlib
import importlib.util
import inspect
import json
import os
import sys
import traceback


def _load_lambda_context():
    """Reaproveita LambdaContext de bootstrap.py (carregado por caminho, para
    não colidir com um módulo 'bootstrap' do código do usuário)."""
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("_awslocalsim_bootstrap", os.path.join(here, "bootstrap.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.LambdaContext


def _emit(out, marker, kind, ident, payload):
    tag = kind if ident is None else "%s:%s" % (kind, ident)
    out.flush()
    out.write("\n%s:%s:BEGIN%s%s:%s:END\n" % (marker, tag, payload, marker, tag))
    out.flush()


def _error_info(exc):
    tb = traceback.format_exception(type(exc), exc, exc.__traceback__)
    return json.dumps(
        {
            "errorType": type(exc).__name__,
            "errorMessage": str(exc),
            "stackTrace": [line.rstrip("\n") for line in tb],
        },
        default=str,
    )


def _start_debug():
    port = os.environ.get("AWS_LOCAL_SIM_DEBUG_PORT")
    if not port:
        return
    host = os.environ.get("AWS_LOCAL_SIM_DEBUG_HOST") or "127.0.0.1"
    try:
        import debugpy  # noqa: WPS433
    except ImportError:
        sys.stderr.write(
            "[aws-local-simulator] debugpy não está instalado neste interpretador (%s). "
            "Instale com: python -m pip install debugpy. Continuando SEM debug.\n" % sys.executable
        )
        sys.stderr.flush()
        return
    try:
        debugpy.listen((host, int(port)))
        sys.stderr.write("[aws-local-simulator] debugpy escutando em %s:%s\n" % (host, port))
        sys.stderr.flush()
        if os.environ.get("AWS_LOCAL_SIM_DEBUG_WAIT") == "1":
            sys.stderr.write("[aws-local-simulator] aguardando o debugger anexar...\n")
            sys.stderr.flush()
            debugpy.wait_for_client()
    except Exception as exc:  # porta ocupada etc.: segue sem debug
        sys.stderr.write("[aws-local-simulator] falha ao iniciar debugpy em %s:%s: %s. Continuando SEM debug.\n" % (host, port, exc))
        sys.stderr.flush()


def main():
    marker = os.environ.get("AWS_LOCAL_SIM_MARKER", "__AWSLOCALSIM__")
    out = sys.stdout
    loop = None
    try:
        LambdaContext = _load_lambda_context()
        _start_debug()

        code_path = os.environ.get("AWS_LOCAL_SIM_CODE_PATH") or os.getcwd()
        if sys.path and os.path.abspath(sys.path[0]) == os.path.dirname(os.path.abspath(__file__)):
            sys.path.pop(0)
        sys.path.insert(0, code_path)

        handler = os.environ["AWS_LOCAL_SIM_HANDLER"]
        module_name, _, fn_name = handler.rpartition(".")
        module = importlib.import_module(module_name.replace("/", "."))
        fn = getattr(module, fn_name)
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    except BaseException as exc:  # falha de init
        try:
            _emit(out, marker, "ERROR", "init", _error_info(exc))
        finally:
            sys.exit(1)

    _emit(out, marker, "READY", None, "{}")

    stdin = sys.stdin.buffer
    while True:
        raw = stdin.readline()
        if not raw:  # EOF
            break
        raw = raw.decode("utf-8").strip()
        if not raw:
            continue
        ident = None
        try:
            msg = json.loads(raw)
            ident = msg.get("id")
            context = LambdaContext(msg.get("context") or {})
            result = fn(msg.get("event"), context)
            if inspect.isawaitable(result):
                result = loop.run_until_complete(result)
            payload = json.dumps(result, default=str)
        except (Exception, SystemExit) as exc:
            _emit(out, marker, "ERROR", ident if ident is not None else "unknown", _error_info(exc))
            continue
        _emit(out, marker, "RESULT", ident, payload)


if __name__ == "__main__":
    main()
