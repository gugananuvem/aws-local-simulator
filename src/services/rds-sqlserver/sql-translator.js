'use strict';

/**
 * Tradutor de SQL do SQL Server (T-SQL) para SQL compatível com SQLite.
 *
 * Responsabilidades:
 * - remover comentários, separadores de lote (GO) e ruído (SET NOCOUNT ON, ON [PRIMARY]);
 * - traduzir funções do T-SQL (GETDATE, NEWID, ISNULL, LEN, DATEADD);
 * - converter TOP em LIMIT, reposicionando-o após ORDER BY;
 * - converter IDENTITY em AUTOINCREMENT e tipos de dados em comandos DDL;
 * - traduzir MERGE simples e UPDATE ... JOIN simples;
 * - reconhecer o batch de descoberta de servidor do SSMS e devolver metadados sintéticos;
 * - remover DECLARE/SET e desembrulhar o subconjunto procedural usado por SSMS
 *   (IF com condição entre parênteses, TRY/CATCH e EXEC sp_executesql literal).
 *
 * IMPORTANTE: translate() nunca altera a string recebida. As substituições são
 * feitas sobre máscaras de mesmo tamanho, que ignoram literais de texto,
 * identificadores entre colchetes e comentários.
 */

const EXPRESSAO_NEWID =
  "lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(2))||'-'||hex(randomblob(6)))";

// SELECT simplificado usado no batch de propriedades de database do SMO.
// O batch original cria tabelas temporarias e usa tabelas de DMV ausentes no
// simulador; esta versao preserva as 144 colunas e le os valores reais de
// sys.databases, substituindo apenas as dependencias indisponiveis.
const SHIM_PROPRIEDADES_DATABASE = "SELECT dtb.name AS [Name], 0 AS [ActiveConnections], dtb.is_auto_close_on AS [AutoClose], dtb.is_auto_shrink_on AS [AutoShrink], dtb.compatibility_level AS [CompatibilityLevel], dtb.create_date AS [CreateDate], CAST(0 AS float) AS [DataSpaceUsage], CAST(0 AS bit) AS [DboLogin], N'' AS [DefaultFileGroup], '' AS [DefaultSchema], dtb.database_id AS [ID], CAST(0 AS float) AS [IndexSpaceUsage], CAST(has_dbaccess(dtb.name) AS bit) AS [IsAccessible], CAST(0 AS bit) AS [IsDbAccessAdmin], CAST(0 AS bit) AS [IsDbBackupOperator], CAST(0 AS bit) AS [IsDbDatareader], CAST(0 AS bit) AS [IsDbDatawriter], CAST(0 AS bit) AS [IsDbDdlAdmin], CAST(0 AS bit) AS [IsDbDenyDatareader], CAST(0 AS bit) AS [IsDbDenyDatawriter], CAST(0 AS bit) AS [IsDbOwner], CAST(0 AS bit) AS [IsDbSecurityAdmin], dtb.is_fulltext_enabled AS [IsFullTextEnabled], CAST(case when NULL is null then 0 else 1 end AS bit) AS [IsMirroringEnabled], CAST( case when SERVERPROPERTY('EngineEdition') = 6 then cast(1 as bit) else cast(0 as bit) end AS bit) AS [IsSqlDw], CAST(case when dtb.name in ('master','model','msdb','tempdb') then 1 else dtb.is_distributor end AS bit) AS [IsSystemObject], ISNULL(suser_sname(dtb.owner_sid),'') AS [Owner], ISNULL(df.physical_name, N'') AS [PrimaryFilePath], (dtb.is_published*1+dtb.is_subscribed*2+dtb.is_merge_published*4) AS [ReplicationOptions], CAST(0 AS float) AS [Size], CAST(0 AS float) AS [SpaceAvailable], case when dtb.collation_name is null then 0x200 else 0 end | case when 1 = dtb.is_in_standby then 0x40 else 0 end | case dtb.state when 1 then 0x2 when 2 then 0x8 when 3 then 0x4 when 4 then 0x10 when 5 then 0x100 when 6 then 0x20 else 1 end AS [Status], '' AS [UserName], dtb.is_ansi_null_default_on AS [AnsiNullDefault], dtb.is_ansi_nulls_on AS [AnsiNullsEnabled], dtb.is_ansi_padding_on AS [AnsiPaddingEnabled], dtb.is_ansi_warnings_on AS [AnsiWarningsEnabled], dtb.is_arithabort_on AS [ArithmeticAbortEnabled], dtb.is_auto_create_stats_on AS [AutoCreateStatisticsEnabled], dtb.is_auto_update_stats_on AS [AutoUpdateStatisticsEnabled], CAST( case when CHARINDEX(N'_CS_', dtb.collation_name) > 0 then 1 when CHARINDEX(N'_BIN', dtb.collation_name) > 0 then 1 else 0 end AS bit) AS [CaseSensitive], dtb.is_cursor_close_on_commit_on AS [CloseCursorsOnCommitEnabled], dtb.collation_name AS [Collation], dtb.is_concat_null_yields_null_on AS [ConcatenateNullYieldsNull], dtb.is_db_chaining_on AS [DatabaseOwnershipChaining], CAST(( case LOWER(convert( nvarchar(128), DATABASEPROPERTYEX(dtb.name, 'Updateability'))) when 'read_write' then 1 else 0 end) AS bit) AS [IsUpdateable], NULL AS [LastBackupDate], NULL AS [LastDifferentialBackupDate], CAST(ISNULL(DATABASEPROPERTYEX(dtb.name, 'lastgoodcheckdbtime'), 0) AS datetime) AS [LastGoodCheckDbTime], NULL AS [LastLogBackupDate], dtb.is_local_cursor_default AS [LocalCursorsDefault], dtb.is_numeric_roundabort_on AS [NumericRoundAbortEnabled], dtb.page_verify_option AS [PageVerify], dtb.is_quoted_identifier_on AS [QuotedIdentifiersEnabled], dtb.is_read_only AS [ReadOnly], dtb.recovery_model AS [RecoveryModel], dtb.is_recursive_triggers_on AS [RecursiveTriggersEnabled], dtb.user_access AS [UserAccess], CAST(DATABASEPROPERTYEX(dtb.name, 'Version') AS int) AS [Version], dtb.is_auto_update_stats_async_on AS [AutoUpdateStatisticsAsync], dtb.is_broker_enabled AS [BrokerEnabled], drs.database_guid AS [DatabaseGuid], ISNULL(DB_NAME(dtb.source_database_id), N'') AS [DatabaseSnapshotBaseName], dtb.is_date_correlation_on AS [DateCorrelationOptimization], ISNULL(N'',N'') AS [DefaultFullTextCatalog], CAST((case when drs.last_log_backup_lsn is not null then 1 else 0 end) AS bit) AS [HasFullBackup], CAST(isnull(dtb.source_database_id, 0) AS bit) AS [IsDatabaseSnapshot], CAST(0 AS bit) AS [IsDatabaseSnapshotBase], 0 AS [IsMailHost], dtb.is_parameterization_forced AS [IsParameterizationForced], dtb.is_read_committed_snapshot_on AS [IsReadCommittedSnapshotOn], CAST(0 AS bit) AS [IsVarDecimalStorageFormatEnabled], ISNULL(dtb.log_reuse_wait,0) AS [LogReuseWaitStatus], ISNULL(0,0) AS [MirroringFailoverLogSequenceNumber], ISNULL(dmi.mirroring_guid,'00000000-0000-0000-0000-000000000000') AS [MirroringID], ISNULL(NULL,'') AS [MirroringPartner], ISNULL(N'','') AS [MirroringPartnerInstance], ISNULL((case N'UNLIMITED' when N'UNLIMITED' then 0 else 0 end),0) AS [MirroringRedoQueueMaxSize], ISNULL(dmi.mirroring_role,0) AS [MirroringRole], ISNULL(0,0) AS [MirroringRoleSequence], ISNULL(0 + 1, 0) AS [MirroringSafetyLevel], ISNULL(0,0) AS [MirroringSafetySequence], ISNULL(dmi.mirroring_state + 1, 0) AS [MirroringStatus], ISNULL(0,0) AS [MirroringTimeout], ISNULL(N'','') AS [MirroringWitness], ISNULL(dmi.mirroring_witness_state + 1, 0) AS [MirroringWitnessStatus], drs.recovery_fork_guid AS [RecoveryForkGuid], dtb.service_broker_guid AS [ServiceBrokerGuid], dtb.snapshot_isolation_state AS [SnapshotIsolationState], dtb.is_trustworthy_on AS [Trustworthy], CAST(ISNULL(ctb.is_auto_cleanup_on,0) AS bit) AS [ChangeTrackingAutoCleanUp], CAST(case when ctb.database_id is null then 0 else 1 end AS bit) AS [ChangeTrackingEnabled], ISNULL(ctb.retention_period,0) AS [ChangeTrackingRetentionPeriod], CAST(ISNULL(ctb.retention_period_units,0) AS tinyint) AS [ChangeTrackingRetentionPeriodUnits], N'' AS [DefaultFileStreamFileGroup], CAST(dtb.is_encrypted AS bit) AS [EncryptionEnabled], CAST(0 AS bit) AS [HasDatabaseEncryptionKey], CAST(dtb.is_honor_broker_priority_on AS bit) AS [HonorBrokerPriority], CAST(0 AS bit) AS [IsManagementDataWarehouse], case when 1=(SELECT CONVERT(bit, current_value) FROM msdb.dbo.syspolicy_configuration WHERE name = 'Enabled') and exists (select * from msdb.dbo.syspolicy_system_health_state where target_query_expression_with_id like 'Server'+ '/Database\\[@ID=' + convert(nvarchar(20),dtb.database_id) + '\\]%' ESCAPE '\\') then 1 else 0 end AS [PolicyHealthState], NULL AS [AvailabilityDatabaseSynchronizationState], dtb.containment AS [ContainmentType], dtb.default_fulltext_language_lcid AS [DefaultFullTextLanguageLcid], ISNULL(dtb.default_fulltext_language_name,N'') AS [DefaultFullTextLanguageName], dtb.default_language_lcid AS [DefaultLanguageLcid], dtb.default_language_name AS [DefaultLanguageName], ISNULL(fsopt.directory_name , N'') AS [FilestreamDirectoryName], ISNULL(fsopt.non_transacted_access , 0) AS [FilestreamNonTransactedAccess], CAST(dtb.is_nested_triggers_on AS bit) AS [NestedTriggersEnabled], dtb.target_recovery_time_in_seconds AS [TargetRecoveryTime], CAST(dtb.is_transform_noise_words_on AS bit) AS [TransformNoiseWords], dtb.two_digit_year_cutoff AS [TwoDigitYearCutoff], dtb.is_auto_create_stats_incremental_on AS [AutoCreateIncrementalStatisticsEnabled], dtb.delayed_durability AS [DelayedDurability], 0 AS [HasFileInCloud], 0 AS [HasMemoryOptimizedObjects], CAST(0 AS float) AS [MemoryAllocatedToMemoryOptimizedObjectsInKB], CAST(0 AS float) AS [MemoryUsedByMemoryOptimizedObjectsInKB], 0 AS [LegacyCardinalityEstimation], 2 AS [LegacyCardinalityEstimationForSecondary], 0 AS [MaxDop], NULL AS [MaxDopForSecondary], 0 AS [ParameterSniffing], 2 AS [ParameterSniffingForSecondary], 0 AS [QueryOptimizerHotfixes], 2 AS [QueryOptimizerHotfixesForSecondary], NULL AS [RemoteDataArchiveCredential], CAST(dtb.is_remote_data_archive_enabled AS bit) AS [RemoteDataArchiveEnabled], NULL AS [RemoteDataArchiveEndpoint], NULL AS [RemoteDataArchiveLinkedServer], 0 AS [RemoteDataArchiveUseFederatedServiceAccount], NULL AS [RemoteDatabaseName], CAST(dtb.is_accelerated_database_recovery_on AS bit) AS [AcceleratedRecoveryEnabled], dtb.catalog_collation_type AS [CatalogCollation], N'' AS [PersistentVersionStoreFileGroup], 0 AS [PersistentVersionStoreSizeKB], CAST(ISNULL(dtb.is_ledger_on, 0) AS bit) AS [IsLedger], dtb.name AS [DatabaseName], dtb.name AS [DatabaseName2], dtb.containment AS [ContainmentType2], dtb.name AS [DatabaseName3], dtb.name AS [DatabaseName4], dtb.name AS [DatabaseName5], dtb.name AS [DatabaseName6] FROM master.sys.databases AS dtb LEFT OUTER JOIN sys.database_mirroring AS dmi ON dmi.database_id = dtb.database_id LEFT OUTER JOIN sys.master_files AS df ON df.database_id = dtb.database_id and 1=df.data_space_id and 1 = df.file_id LEFT OUTER JOIN sys.database_recovery_status AS drs ON drs.database_id = dtb.database_id LEFT OUTER JOIN sys.change_tracking_databases AS ctb ON ctb.database_id = dtb.database_id LEFT OUTER JOIN sys.database_filestream_options AS fsopt ON fsopt.database_id = dtb.database_id WHERE (dtb.name=@_msparam_3)";

// Tipos convertidos somente dentro de CREATE TABLE / ALTER TABLE.
// A ordem importa: formas mais específicas vêm primeiro.
const TIPOS_DDL = [
  [/\bNVARCHAR\s*\(\s*(?:\d+|MAX)\s*\)/i, 'TEXT'],
  [/\bVARCHAR\s*\(\s*(?:\d+|MAX)\s*\)/i, 'TEXT'],
  [/\bNCHAR\s*\(\s*\d+\s*\)/i, 'TEXT'],
  [/\bCHAR\s*\(\s*\d+\s*\)/i, 'TEXT'],
  [/\bUNIQUEIDENTIFIER\b/i, 'TEXT'],
  [/\bSYSNAME\b/i, 'TEXT'],
  [/\bXML\b/i, 'TEXT'],
  [/\bTEXT\b/i, 'TEXT'],
  [/\bSMALLDATETIME\b/i, 'TEXT'],
  [/\bDATETIME2\s*\(\s*\d+\s*\)/i, 'TEXT'],
  [/\bDATETIME2\b/i, 'TEXT'],
  [/\bDATETIME\b/i, 'TEXT'],
  [/\bDATE\b/i, 'TEXT'],
  [/\bTIME\s*\(\s*\d+\s*\)/i, 'TEXT'],
  [/\bTIME\b/i, 'TEXT'],
  [/\bSMALLMONEY\b/i, 'REAL'],
  [/\bMONEY\b/i, 'REAL'],
  [/\bDECIMAL\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\)/i, 'REAL'],
  [/\bNUMERIC\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\)/i, 'REAL'],
  [/\bDOUBLE\s+PRECISION\b/i, 'REAL'],
  [/\bDOUBLE\b/i, 'REAL'],
  [/\bFLOAT\b/i, 'REAL'],
  [/\bREAL\b/i, 'REAL'],
  [/\bVARBINARY\s*\(\s*(?:\d+|MAX)\s*\)/i, 'BLOB'],
  [/\bBINARY\s*\(\s*\d+\s*\)/i, 'BLOB'],
  [/\bIMAGE\b/i, 'BLOB'],
  [/\bBIGINT\b/i, 'INTEGER'],
  [/\bSMALLINT\b/i, 'INTEGER'],
  [/\bTINYINT\b/i, 'INTEGER'],
  [/\bINT\b/i, 'INTEGER'],
  [/\bBIT\b/i, 'INTEGER']
];

// Unidades aceitas por DATEADD e seus equivalentes em modificadores SQLite.
const UNIDADES_DATEADD = {
  year: { modificador: 'years', fator: 1 },
  yyyy: { modificador: 'years', fator: 1 },
  yy: { modificador: 'years', fator: 1 },
  quarter: { modificador: 'months', fator: 3 },
  qq: { modificador: 'months', fator: 3 },
  q: { modificador: 'months', fator: 3 },
  month: { modificador: 'months', fator: 1 },
  mm: { modificador: 'months', fator: 1 },
  m: { modificador: 'months', fator: 1 },
  dayofyear: { modificador: 'days', fator: 1 },
  dy: { modificador: 'days', fator: 1 },
  day: { modificador: 'days', fator: 1 },
  dd: { modificador: 'days', fator: 1 },
  d: { modificador: 'days', fator: 1 },
  week: { modificador: 'days', fator: 7 },
  wk: { modificador: 'days', fator: 7 },
  ww: { modificador: 'days', fator: 7 },
  weekday: { modificador: 'days', fator: 1 },
  dw: { modificador: 'days', fator: 1 },
  w: { modificador: 'days', fator: 1 },
  hour: { modificador: 'hours', fator: 1 },
  hh: { modificador: 'hours', fator: 1 },
  minute: { modificador: 'minutes', fator: 1 },
  mi: { modificador: 'minutes', fator: 1 },
  n: { modificador: 'minutes', fator: 1 },
  second: { modificador: 'seconds', fator: 1 },
  ss: { modificador: 'seconds', fator: 1 },
  s: { modificador: 'seconds', fator: 1 }
};

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class SqlTranslator {
  /**
   * @param {string} engine - motor do RDS, por exemplo 'sqlserver-se'.
   */
  constructor(engine = 'sqlserver-se') {
    if (typeof engine !== 'string' || !/^sqlserver-/i.test(engine)) {
      const erro = new Error(
        `Engine inválido: ${engine}. Use um valor iniciado com 'sqlserver-'.`
      );
      erro.code = 'InvalidParameterValue';
      throw erro;
    }
    this.engine = engine;
  }

  /**
   * Traduz uma instrução T-SQL para SQLite. Nunca muta a entrada.
   *
   * @param {string} sql
   * @returns {string}
   */
  translate(sql) {
    if (typeof sql !== 'string') {
      return sql;
    }

    // GETDATE() usado em INSERT/UPDATE precisa gerar número (Unix timestamp),
    // não texto: colunas INT do SQLite com afinidade numérica gravam o texto de
    // datetime('now') como TEXT e o TDS devolve 0. Em SELECT o valor continua
    // sendo datetime('now') para chegar ao cliente como DATETIME.
    const codigoOriginal = this._mascarar(sql).code;
    const semPrefixo = codigoOriginal.replace(
      /^(?:\s|USE\s+[^;]*;|SET\s+[^;]*;|GO\s*(?:\r?\n|;))*/i,
      ''
    );
    const gravarDataHora = /^(?:INSERT|UPDATE|MERGE)\b/i.test(semPrefixo);

    // Ao listar parametros de procedure numerada, o SMO embrulha o SELECT em
    // BEGIN/END com uma CTE mycte sobre sys.numbered_procedure_parameters. O
    // tradutor nao executa blocos procedurais, então removemos o envelope e
    // usamos sys.all_parameters (toda procedure comum tem numero 1).
    if (/\bWith\s+mycte\s*\(/i.test(sql) && /\bnumbered_procedure_parameters\b/i.test(sql)) {
      const selecao = sql.match(/\n\s*SELECT\b[\s\S]*$/i);
      if (selecao) {
        sql = selecao[0].replace(/\r?\n\s*end\s*$/i, '');
        sql = sql
          .replace(/\bmycte\s+AS\s+param\b/gi, 'sys.all_parameters AS param')
          .replace(/\s+AND\s+CAST\(param\.procedure_number\s+AS\s+int\)=nsp\.procedure_number/gi, '');
      }
    }

    // Ao gerar o script de uma procedure numerada, o SMO le a propriedade
    // [Text]. O SQL Server devolve NULL nessa coluna e monta o texto a partir
    // de [Definition], mas o caminho do SMO exige o texto preenchido: se [Text]
    // chegar nulo, GetTextProperty() lanca NullReferenceException.
    if (/\bnumbered_procedures\b/i.test(sql) && /\bNULL\s+AS\s+\[Text\]/i.test(sql)) {
      sql = sql.replace(/\bNULL\s+AS\s+\[Text\]/gi, 'nsp.definition AS [Text]');
    }

    // O SMO precisa de [Text] preenchido para gerar "ALTER VIEW". No SQL Server
    // a coluna vem como NULL e o texto e montado de [Definition]; aqui devolvemos
    // a propria definicao para o caminho de alteracao nao gerar script vazio.
    if (
      /\b(?:sys|main)\.(?:all_views|views|system_views)\b/i.test(sql) &&
      /\bNULL\s+AS\s+\[Text\]/i.test(sql) &&
      /\bJOIN\s+(?:sys|main)\.sql_modules\s+AS\s+smv\b/i.test(sql)
    ) {
      sql = sql.replace(
        /\bNULL\s+AS\s+\[Text\]/gi,
        'COALESCE(smv.definition, ssmv.definition) AS [Text]'
      );
    }

    // Quando o cliente tambem pede [BodyStartIndex], ele divide o texto em
    // cabecalho/corpo usando esse indice. Preenchê-lo evita que o SMO tente
    // recalcular o indice a partir de um cabecalho que nao existe.
    if (/\bnumbered_procedures\b/i.test(sql) && /\bNULL\s+AS\s+\[BodyStartIndex\]/i.test(sql)) {
      sql = sql.replace(
        /\bNULL\s+AS\s+\[BodyStartIndex\]/gi,
        "CASE WHEN instr(nsp.definition, 'BEGIN') > 0 " +
          "THEN instr(nsp.definition, 'BEGIN') - 1 ELSE 0 END AS [BodyStartIndex]"
      );
    }

    // O SMO envia procedure_number como nvarchar ('1'). Como a coluna da view
    // e uma constante sem afinidade, o SQLite compara inteiro com texto e nao
    // devolve linha; sem isso o NumberedStoredProcedure fica sem Text e o
    // Script() lanca NullReferenceException.
    if (/\bnumbered_procedures\b/i.test(sql)) {
      sql = sql.replace(
        /(\bprocedure_number\s*=\s*)(@_msparam_\d+)/gi,
        '$1CAST($2 AS INTEGER)'
      );
    }

    // O SMO le as opcoes do usuario antes de gerar o script de uma funcao.
    // O batch declara @UserOption e devolve um bit por opcao; o SQLite nao
    // executa declaracao, entao devolvemos as colunas com os valores padrao.
    if (/\bdeclare\s+@UserOption\b/i.test(sql) && /\[AnsiNulls\]/i.test(sql)) {
      const colunas = [...sql.matchAll(/AS\s+\[([A-Za-z]+)\]/g)]
        .map((correspondencia) => correspondencia[1]);
      if (colunas.length) {
        return `SELECT ${colunas
          .map((nome) => `CAST(0 AS bit) AS [${nome}]`)
          .join(', ')}`;
      }
    }

    // O SMO encerra consultas de disponibilidade com varios DROP TABLE sem
    // ponto e virgula. No SQLite cada DROP precisa ser um comando separado e
    // IF EXISTS evita falhar quando a tabela temporaria nunca foi criada.
    const quedas = [...sql.matchAll(/\bdrop\s+table\s+(#{1,2}[A-Za-z_]\w*)/gi)];
    const residuo = sql
      .replace(/\bdrop\s+table\s+#{1,2}[A-Za-z_]\w*/gi, '')
      .replace(/[\s;]/g, '');
    if (quedas.length && !residuo) {
      return quedas
        .map((m) => `DROP TABLE IF EXISTS ${this._traduzirTabelasTemporarias(m[1])}`)
        .join('; ');
    }

    let resultado = this._removerExecBackupHistory(sql);
    resultado = this._traduzirRotinas(resultado);
    resultado = this._removerShimAvailabilityGroups(resultado);
    resultado = this._removerShimRemoteDataArchive(resultado);
    resultado = this._removerShimDataRetention(resultado);
    // O SMO usa a sintaxe T-SQL "[alias] = expressao" na lista de SELECT.
    // O SQLite so aceita "expressao AS [alias]".
    resultado = resultado.replace(
      /\[(ledger_transaction_id_column_name|ledger_sequence_number_column_name|ledger_operation_type_column_name|ledger_operation_type_desc_column_name)\]\s*=\s*(MAX\(CASE[\s\S]*?END\))/gi,
      (_correspondencia, nome, expressao) => `${expressao} AS [${nome}]`
    );
    resultado = resultado.replace(
      /\bDROP\s+TABLE\s+#{1,2}[A-Za-z_]\w*/gi,
      (correspondencia, deslocamento, texto) => {
        let anterior = deslocamento - 1;
        while (anterior >= 0 && /\s/.test(texto[anterior])) anterior -= 1;
        return anterior < 0 || texto[anterior] === ';'
          ? correspondencia
          : `; ${correspondencia}`;
      }
    );
    resultado = this._removerComentarios(resultado);
    resultado = this.splitBatches(resultado).join(' ');
    resultado = this._normalizarWhitespace(resultado);
    resultado = this._traduzirMetadadosCliente(resultado);
    resultado = this._traduzirTabelasTemporarias(resultado);
    resultado = this._removerPrefixoN(resultado);
    // COLLATE database_default e usado pelo SMO ao montar o catalogo de
    // arquivos. O SQLite nao conhece essa collation e rejeita a consulta toda.
    resultado = resultado.replace(/\s+COLLATE\s+(?:\[?database_default\]?)/gi, '');
    // A lista de Stored Procedures do SSMS passa os filtros de is_ms_shipped e
    // uses_native_compilation como nvarchar ('0'/'1'). O SQL Server converte
    // implicitamente para bit; o SQLite compara texto com numero e nao acha a
    // procedure. Forcamos CAST para os dois parametros booleanos da consulta.
    if (/\bAS\s+\[IsNativelyCompiled\]/i.test(resultado) && /\bsys\.all_objects\b/i.test(resultado)) {
      resultado = resultado.replace(
        /(\bAS\s+bit\)\s*=\s*)(@_msparam_\d+)/gi,
        '$1CAST($2 AS INTEGER)'
      );
      resultado = resultado.replace(
        /(uses_native_compilation\s*,\s*0\)\s*=\s*)(@_msparam_\d+)/gi,
        '$1CAST($2 AS INTEGER)'
      );
      // A lista de Scalar-valued Functions passa o tipo da funcao (1 = FN)
      // como nvarchar no primeiro parametro; o CASE termina com 'end)='.
      resultado = resultado.replace(
        /(\bend\s*\)\s*=\s*)(@_msparam_\d+)/gi,
        '$1CAST($2 AS INTEGER)'
      );
      // O script de "Modify" de uma funcao procura o parametro de retorno com
      // is_output = '1'. O SQLite compara texto com numero e nao encontraria.
      resultado = resultado.replace(
        /(\bis_output\s*=\s*)(@_msparam_\d+)/gi,
        '$1CAST($2 AS INTEGER)'
      );
    }
    resultado = this._traduzirParametrosSmo(resultado);
    resultado = this._removerRuido(resultado);
    resultado = this._removerColchetesSimples(resultado);
    resultado = this._removerEsquema(resultado);
    resultado = resultado.replace(
      /\bmsdb\s*\.\s*fn_syspolicy_is_automation_enabled\b/gi,
      'fn_syspolicy_is_automation_enabled'
    );
    resultado = this._traduzirCatalogoLocal(resultado);
    // fn_helpcollations() e uma table-valued function no SQL Server; no SQLite
    // ela e uma tabela comum do catalogo master anexado como schema sys.
    resultado = resultado.replace(
      /\b(?:sys\s*\.\s*)?fn_helpcollations\s*\(\s*\)/gi,
      'sys.fn_helpcollations'
    );
    // dm_io_virtual_file_stats e uma table-valued function; o SMO chama com
    // DEFAULT para "todos os databases/arquivos". No simulador ela e uma
    // tabela comum do catalogo master anexado como schema sys.
    resultado = resultado.replace(
      /\bdm_io_virtual_file_stats\s*\(\s*(?:default|-?\d+)\s*,\s*(?:default|-?\d+)\s*\)/gi,
      'dm_io_virtual_file_stats'
    );
    // O SMO usa um GUID com 32 zeros como default, invalido para o tipo
    // uniqueidentifier do TDS (o formato correto tem 12 digitos no ultimo grupo).
    resultado = resultado.replace(
      /'00000000-0000-0000-0000-0000000000000000'/g,
      "'00000000-0000-0000-0000-000000000000'"
    );
    // VolumeFreeSpace e lido pelo SMO com GetInt64(); NULL estoura
    // "Data is Null. This method or property cannot be called on Null values".
    resultado = resultado.replace(
      /\bnull\s+AS\s+\[VolumeFreeSpace\]/gi,
      '-1 AS [VolumeFreeSpace]'
    );
    // O SMO inverte allow_row_locks/allow_page_locks com "~". No SQLite
    // "~1" devolve -2 (verdadeiro), e o script gerado sai com ALLOW_*_LOCKS=OFF.
    resultado = resultado.replace(
      /~(\s*\w+\s*\.\s*)?(allow_row_locks|allow_page_locks)\b/gi,
      (_correspondência, prefixo, coluna) => `(1 - ${prefixo || ''}${coluna})`
    );
    resultado = this._traduzirLiteraisHex(resultado);
    resultado = this._traduzirLiteraisData(resultado);
    resultado = this._traduzirProcedural(resultado);
    resultado = this._traduzirVariaveisSistema(resultado);
    resultado = this._traduzirConcatenacao(resultado);
    resultado = this._traduzirMerge(resultado);
    resultado = this._traduzirUpdateJoin(resultado);
    resultado = this._traduzirFuncoes(resultado, gravarDataHora);
    resultado = this._traduzirTop(resultado);
    resultado = this._traduzirDdl(resultado);
    resultado = this._normalizarWhitespace(resultado);

    return resultado;
  }

  /**
   * Separa o SQL em lotes usando GO (fora de literais de texto e comentários).
   *
   * @param {string} sql
   * @returns {string[]}
   */
  splitBatches(sql) {
    if (typeof sql !== 'string') {
      return [];
    }

    const máscara = this._mascarar(sql);
    const código = máscara.code;
    const lotes = [];
    let início = 0;
    let correspondedência;
    const regex = /\bGO\b/gi;

    while ((correspondedência = regex.exec(código)) !== null) {
      const fimPalette = correspondedência.index + correspondedência[0].length;
      const caractereAntes =
        correspondedência.index === 0 ? '' : código[correspondedência.index - 1];
      const caractereDepois = fimPalette >= código.length ? '' : código[fimPalette];
      const limiteAntes = caractereAntes === '' || /[\s;]/.test(caractereAntes);
      const limiteDepois = caractereDepois === '' || /[\s;]/.test(caractereDepois);

      if (!limiteAntes || !limiteDepois) {
        continue;
      }

      lotes.push(sql.slice(início, correspondedência.index));
      início = fimPalette;
      // O ponto e vírgula depois de GO faz parte do separador, não do lote.
      while (início < sql.length && /[\s;]/.test(sql[início])) {
        início += 1;
      }
    }

    lotes.push(sql.slice(início));

    return lotes
      .map((lote) => lote.trim().replace(/;+\s*$/, '').trim())
      .filter((lote) => lote.length > 0);
  }

  /**
   * Constrói máscaras de mesmo tamanho do SQL original. `code` esconde textos,
   * identificadores entre colchetes/aspas e comentários; `noStrings` esconde
   * apenas textos e comentários (útil para ON [PRIMARY]).
   *
   * @private
   */
  _mascarar(sql) {
    let code = '';
    let noStrings = '';
    const tokens = [];
    let i = 0;

    while (i < sql.length) {
      const caractere = sql[i];

      if (caractere === "'") {
        const início = i;
        i += 1;
        while (i < sql.length) {
          if (sql[i] === "'" && sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          if (sql[i] === "'") {
            i += 1;
            break;
          }
          i += 1;
        }
        const espaço = ' '.repeat(i - início);
        code += espaço;
        noStrings += espaço;
        tokens.push({ tipo: 'texto', início, fim: i, valor: sql.slice(início, i) });
        continue;
      }

      if (caractere === '[' || caractere === '"') {
        const fecho = caractere === '[' ? ']' : '"';
        const início = i;
        i += 1;
        while (i < sql.length) {
          if (caractere === '[' && sql[i] === ']' && sql[i + 1] === ']') {
            i += 2;
            continue;
          }
          if (sql[i] === fecho) {
            i += 1;
            break;
          }
          i += 1;
        }
        const valor = sql.slice(início, i);
        code += ' '.repeat(valor.length);
        noStrings += valor;
        tokens.push({
          tipo: caractere === '[' ? 'colchete' : 'aspas',
          início,
          fim: i,
          valor
        });
        continue;
      }

      if (caractere === '-' && sql[i + 1] === '-') {
        const início = i;
        i += 2;
        while (i < sql.length && sql[i] !== '\n') {
          i += 1;
        }
        const espaço = ' '.repeat(i - início);
        code += espaço;
        noStrings += espaço;
        tokens.push({ tipo: 'comentario', início, fim: i, valor: sql.slice(início, i) });
        continue;
      }

      if (caractere === '/' && sql[i + 1] === '*') {
        const início = i;
        let profundidade = 1;
        i += 2;
        while (i < sql.length && profundidade > 0) {
          if (sql[i] === '/' && sql[i + 1] === '*') {
            profundidade += 1;
            i += 2;
            continue;
          }
          if (sql[i] === '*' && sql[i + 1] === '/') {
            profundidade -= 1;
            i += 2;
            continue;
          }
          i += 1;
        }
        const espaço = ' '.repeat(i - início);
        code += espaço;
        noStrings += espaço;
        tokens.push({ tipo: 'comentario', início, fim: i, valor: sql.slice(início, i) });
        continue;
      }

      const início = i;
      if (/[A-Za-z0-9_@#$]/.test(caractere)) {
        while (i < sql.length && /[A-Za-z0-9_@#$]/.test(sql[i])) {
          i += 1;
        }
      } else {
        i += 1;
      }
      const valor = sql.slice(início, i);
      code += valor;
      noStrings += valor;
      tokens.push({
        tipo: valor.startsWith('@') ? 'variavel' : /^\w/.test(valor) ? 'palavra' : 'pontuacao',
        início,
        fim: i,
        valor
      });
    }

    return { code, noStrings, tokens, sql };
  }

  /** Remove comentários preservando o restante da string. @private */
  _removerComentarios(sql) {
    const tokens = this._mascarar(sql).tokens.filter((token) => token.tipo === 'comentario');
    if (tokens.length === 0) {
      return sql;
    }
    let resultado = sql;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const token = tokens[i];
      resultado = resultado.slice(0, token.início) + resultado.slice(token.fim);
    }
    return resultado;
  }

  /** Colapsa espaços, tabulações e quebras de linha. @private */
  _normalizarWhitespace(sql) {
    return sql.replace(/\s+/g, ' ').trim();
  }

  /** Remove ruído de conexão específico do SQL Server/ODBC. @private */
  _removerRuido(sql) {
    // Clientes ODBC (sqlcmd, JDBC, tedious) enviam SETs de sessão antes da consulta.
    // Eles não têm equivalente no SQLite e devem desaparecer sem afetar `SET @var = ...`.
    const opcoesSessao = [
      'ANSI_DEFAULTS',
      'ANSI_NULL_DFLT_OFF',
      'ANSI_NULL_DFLT_ON',
      'ANSI_NULLS',
      'ANSI_PADDING',
      'ANSI_WARNINGS',
      'ARITHABORT',
      'ARITHIGNORE',
      'CONCAT_NULL_YIELDS_NULL',
      'CURSOR_CLOSE_ON_COMMIT',
      'FMTONLY',
      'FORCEPLAN',
      'IMPLICIT_TRANSACTIONS',
      'NOCOUNT',
      'NOEXEC',
      'NUMERIC_ROUNDABORT',
      'PARSEONLY',
      'QUOTED_IDENTIFIER',
      'REMOTE_PROC_TRANSACTIONS',
      'STATISTICS\\s+(?:IO|PROFILE|TIME|XML)',
      'TEXTSIZE',
      'XACT_ABORT'
    ].join('|');

    let resultado = this._substituirTodos(
      sql,
      `\\bSET\\s+(?:${opcoesSessao})\\s+(?:ON|OFF|-?\\d+)\\b`,
      () => ''
    );

    // Opções com valores textuais ou multinível enviadas pelo SqlClient/SSMS.
    resultado = this._substituirTodos(
      resultado,
      '\\bSET\\s+(?:ROWCOUNT|LOCK_TIMEOUT|QUERY_GOVERNOR_COST_LIMIT)\\s+-?\\d+\\b|' +
        '\\bSET\\s+DEADLOCK_PRIORITY\\s+(?:LOW|NORMAL|HIGH|-?\\d+)\\b|' +
        '\\bSET\\s+TRANSACTION\\s+ISOLATION\\s+LEVEL\\s+' +
        '(?:READ\\s+(?:UNCOMMITTED|COMMITTED|REPEATABLE|SNAPSHOT)|SERIALIZABLE)\\b',
      () => ''
    );

    // O SMO as vezes prefixa a consulta com `use [master];` no mesmo batch.
    // O DbEngine ja trocou o database pela conexao, e o SQLite nao entende USE.
    // So removemos quando ha ponto e virgula: `use [model]` sozinho e tratado
    // pelo DbEngine como comando de troca de contexto.
    resultado = resultado.replace(
      /\buse\s+\[?[A-Za-z_]\w*\]?\s*;/gi,
      () => ''
    );

    return resultado;
  }

  /** Remove o prefixo `N` das literais Unicode (N'texto'). @private */
  _removerPrefixoN(sql) {
    return sql.replace(/\bN(?=')/gi, '');
  }

  /**
   * O SFC/SMO envia sp_executesql com parametros nomeados @_msparam_N. O SQLite
   * so entende placeholders posicionais, e o DbEngine ja recebe os valores.
   * @private
   */
  _traduzirParametrosSmo(sql) {
    return sql.replace(/@_msparam_\d+\b/gi, '?');
  }

  /**
   * Tabelas temporarias do T-SQL (#nome) nao sao identificadores validos no
   * SQLite. O SMO usa #tmp_* em varios batches, inclusive em DROP TABLE.
   * @private
   */
  _traduzirTabelasTemporarias(sql) {
    const código = this._mascarar(sql).code;
    let resultado = '';
    let último = 0;
    const temporaria = /#{1,2}[A-Za-z_]\w*/g;
    let correspondência;
    while ((correspondência = temporaria.exec(código)) !== null) {
      resultado += sql.slice(último, correspondência.index);
      resultado += `_tmp_${correspondência[0].replace(/^#+/, '')}`;
      último = correspondência.index + correspondência[0].length;
    }
    return resultado + sql.slice(último);
  }

  /**
   * Converte parametros nomeados (@p, @nome) em placeholders quando o chamador
   * informou valores ligados. A mascara preserva `@` dentro de textos e nomes.
   * @param {string} sql
   * @param {number} quantidade
   * @returns {string}
   */
  substituirParametros(sql, parametros) {
    const valores = Array.isArray(parametros) ? parametros : [];
    if (!valores.length || typeof sql !== 'string') {
      return { sql, parametros: valores };
    }
    const código = this._mascarar(sql).code;
    const indicePorNome = new Map();
    const expandidos = [];
    let resultado = '';
    let último = 0;
    const parametro = /@[A-Za-z_][\w]*/g;
    let correspondência;
    while ((correspondência = parametro.exec(código)) !== null) {
      const nome = correspondência[0].toLowerCase();
      let indice = indicePorNome.get(nome);
      if (indice === undefined) {
        indice = indicePorNome.size;
        indicePorNome.set(nome, indice);
      }
      resultado += sql.slice(último, correspondência.index) + '?';
      último = correspondência.index + correspondência[0].length;
      expandidos.push(indice < valores.length ? valores[indice] : null);
    }
    if (indicePorNome.size === 0) {
      return { sql, parametros: valores };
    }
    return { sql: resultado + sql.slice(último), parametros: expandidos };
  }

  /**
   * Converte literais hexadecimal (0x1000000) em decimais. O SQLite interpreta
   * 0x... como BLOB, o que faz calculos de versao e bitmask do SMO retornarem 0.
   * A mascara evita alterar digitos dentro de textos e identificadores.
   * @private
   */
  _traduzirLiteraisHex(sql) {
    const código = this._mascarar(sql).code;
    let resultado = '';
    let último = 0;
    const hexadecimal = /0x([0-9a-f]+)/gi;
    let correspondência;
    while ((correspondência = hexadecimal.exec(código)) !== null) {
      resultado += sql.slice(último, correspondência.index);
      resultado += String(parseInt(correspondência[1], 16));
      último = correspondência.index + correspondência[0].length;
    }
    return resultado + sql.slice(último);
  }

  /**
   * Converte o literal de data ODBC `{d '1970-01-01'}` (usado pelo SSMS ao
   * gerar funcoes) em um literal que o SQLite entenda.
   * @private
   */
  _traduzirLiteraisData(sql) {
    return sql.replace(/\{\s*d\s*(['"])([\s\S]*?)\1\s*\}/gi, (_todo, _aspas, valor) => `'${valor}'`);
  }

  /** Traduz as variáveis globais do T-SQL para literais SQLite. @private */
  _traduzirVariaveisSistema(sql) {
    return sql
      .replace(/@@MICROSOFTVERSION\b/gi, '268439491')
      .replace(/@@SPID\b/gi, '1')
      .replace(/@@TRANCOUNT\b/gi, '0')
      .replace(/@@VERSION\b/gi, "'16.00.4035.2'");
  }

  /**
   * Remove colchetes de identificadores simples. O SSMS qualifica tabelas do
   * catalogo como `[master].[sys].[all_objects]`; no SQLite isso seria tres
   * segmentos (database.schema.tabela), que nao e suportado.
   * @private
   */
  _removerColchetesSimples(sql) {
    return this._substituirTodos(
      sql,
      '\\[(?:master|sys|msdb|tempdb|model)\\](?:\\s*\\.\\s*\\[[A-Za-z_][A-Za-z0-9_]*\\])+',
      (correspondencia) => correspondencia[0].replace(/\[|\]/g, ''),
      true
    );
  }

  /**
   * Remove `dbo.` e normaliza `master.sys.` para `sys.` — no SQLite o catálogo
   * de sistema é um schema anexado, não um database qualificado.
   * @private
   */
  _removerEsquema(sql) {
    // Nomes de tres partes apontando para o database atual (por exemplo,
    // Ultrapoints2.dbo.TB000) nao tem significado no SQLite: o database aberto
    // ja e o "main". Remove-se o qualificador do database, mas preservando os
    // databases de sistema anexados (master, msdb, tempdb, model) e o proprio
    // dbo, que tem tratamento proprio logo abaixo.
    const identificadorNaoSistema = [
      '(?:',
      '\\[(?!master\\]|msdb\\]|tempdb\\]|model\\]|sys\\]|dbo\\])[^\\]]+\\]',
      '|"(?!master"|msdb"|tempdb"|model"|sys"|dbo")[^"]+"',
      '|\\b(?!master\\b|msdb\\b|tempdb\\b|model\\b|sys\\b|dbo\\b)[A-Za-z_][\\w$#@]*',
      ')'
    ].join('');
    const qualificadorDatabase = [
      // Aceita tambem o nome de quatro partes (servidor.database.dbo.tabela).
      `(?:${identificadorNaoSistema}\\s*\\.\\s*)?`,
      identificadorNaoSistema,
      '\\s*\\.\\s*(?:\\[dbo\\]|"dbo"|dbo)\\s*\\.\\s*'
    ].join('');
    let resultado = this._substituirTodos(sql, qualificadorDatabase, () => '', true);
    resultado = this._substituirTodos(resultado, '\\bmaster\\s*\\.\\s*sys\\s*\\.\\s*', () => 'sys.');
    resultado = this._substituirTodos(resultado, '\\bdbo\\s*\\.\\s*', () => '');

    const tokens = this._mascarar(resultado).tokens;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const token = tokens[i];
      if (!['colchete', 'aspas'].includes(token.tipo) || !/^(?:\[dbo\]|"dbo")$/i.test(token.valor)) {
        continue;
      }

      let proximo = token.fim;
      while (proximo < resultado.length && /\s/.test(resultado[proximo])) proximo += 1;
      if (resultado[proximo] !== '.') continue;

      proximo += 1;
      while (proximo < resultado.length && /\s/.test(resultado[proximo])) proximo += 1;
      resultado = resultado.slice(0, token.início) + resultado.slice(proximo);
    }

    return resultado;
  }

  /**
   * O SMO consulta Grupos de Disponibilidade criando tabelas temporarias e
   * preenchendo-as dentro de blocos IF/BEGIN...END condicionados a
   * HAS_PERMS_BY_NAME. Como nao ha suporte a procedurais, mantemos apenas as
   * CREATE TABLE (vazias) e o SELECT final: os joins continuam validos e o
   * campo de sincronizacao volta como NULL.
   * @private
   */
  _removerShimAvailabilityGroups(sql) {
    if (!/#tmp_db_ars\b/i.test(sql) || !/#tmp_sync_states\b/i.test(sql)) return sql;

    const inicioCondicao = sql.search(/\bif\s*\(\s*@HasViewPermission\b/i);
    if (inicioCondicao < 0) return sql;

    const criacoes = sql
      .slice(0, inicioCondicao)
      .split(/(?=\bcreate\s+table\b)/i)
      .filter((trecho) => /\bcreate\s+table\b/i.test(trecho))
      .map((trecho) => trecho.trim().replace(/^create\s+table\b/i, 'CREATE TABLE IF NOT EXISTS'))
      .join('; ');

    const inicioSelecao = sql.search(/\bSELECT\s+dtb\.name\s+AS\s+\[Database_Name\]/i);
    if (inicioSelecao < 0) return sql;
    const selecao = sql.slice(inicioSelecao).trim();

    return `${criacoes}; ${selecao}`;
  }

  /**
   * O script de DROP DATABASE gerado pelo SSMS começa limpando o historico de
   * backup no msdb. A procedure é irrelevante para o simulador (nao ha backup
   * real), mas o EXEC genérico é rejeitado pelo validador procedural.
   * @private
   */
  _removerExecBackupHistory(sql) {
    return sql.replace(
      /\bEXEC(?:UTE)?\s+(?:msdb\s*\.\s*(?:dbo\s*\.\s*)?)?sp_delete_database_backuphistory\b[^;]*/gi,
      ''
    );
  }

  /**
   * CREATE/ALTER/DROP PROCEDURE são DDL de rotina: o DbEngine executa o efeito
   * no catalogo antes da tradução. Aqui apenas evitamos que o SQLite receba a
   * sintaxe T-SQL bruta caso a instrução chegue até o tradutor diretamente.
   * @private
   */
  _traduzirRotinas(sql) {
    const nome = '(?:\\[[^\\]]+\\]|[A-Za-z_]\\w*)(?:\\s*\\.\\s*(?:\\[[^\\]]+\\]|[A-Za-z_]\\w*))?';
    const criacao = new RegExp(`^\\s*(CREATE|ALTER)\\s+(?:OR\\s+ALTER\\s+)?PROC(?:EDURE)?\\s+${nome}`, 'i').exec(sql);
    if (criacao) {
      const rotulo = /^alter/i.test(criacao[1]) ? 'ProcedureAltered' : 'ProcedureCreated';
      return `SELECT 1 AS [${rotulo}]`;
    }

    const remocao = new RegExp(`^\\s*DROP\\s+PROC(?:EDURE)?\\s+(?:IF\\s+EXISTS\\s+)?${nome}`, 'i').exec(sql);
    if (remocao) return 'SELECT 1 AS [ProcedureDropped]';

    // CREATE FUNCTION tambem e DDL de rotina: o DbEngine registra o corpo e a
    // funcao SQLite antes da traducao. Sem esta regra o validador procedural
    // rejeitaria o BEGIN...END/RETURN do corpo da funcao.
    const funcao = new RegExp(`^\\s*(CREATE|ALTER)\\s+(?:OR\\s+ALTER\\s+)?FUNCTION\\s+${nome}`, 'i').exec(sql);
    if (funcao) {
      const rotulo = /^alter/i.test(funcao[1]) ? 'FunctionAltered' : 'FunctionCreated';
      return `SELECT 1 AS [${rotulo}]`;
    }

    const remocaoFuncao = new RegExp(`^\\s*DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?${nome}`, 'i').exec(sql);
    if (remocaoFuncao) return 'SELECT 1 AS [FunctionDropped]';

    // Chamadas a funcoes escalares do usuario chegam como dbo.Nome(...). O
    // SQLite nao aceita ponto no nome de uma funcao, e a UDF e registrada com
    // o nome simples.
    return sql.replace(/\bdbo\s*\.\s*([A-Za-z_]\w*)\s*(?=\()/gi, '$1');
  }

  /**
   * O SMO cria uma tabela temporaria e preenche via IF/EXECUTE dinamico para
   * consultar arquivamento remoto. Como nao ha suporte a EXEC, removemos esse
   * bloco e deixamos a tabela vazia: os joins seguintes continuam validos.
   * @private
   */
  _removerShimRemoteDataArchive(sql) {
    if (!/#tmp_extended_remote_data_archive_tables/i.test(sql)) return sql;
    if (!/\bIF\s+EXISTS\s*\(/i.test(sql) || !/\bEXECUTE\s*\(\s*N?'/i.test(sql)) return sql;

    const inicio = sql.search(/\bIF\s+EXISTS\s*\(/i);
    const fim = sql.search(/\bSELECT\s+tbl\.name\s+AS\s+\[Name\]/i);
    if (inicio < 0 || fim <= inicio) return sql;
    const criacao = sql
      .slice(0, inicio)
      .trim()
      .replace(/\bCREATE\s+TABLE\b/i, (correspondencia) => `${correspondencia} IF NOT EXISTS`);
    return `${criacao}; ${sql.slice(fim)}`;
  }

  /**
   * O SMO preenche #temp_data_retention_property com IF/EXEC dinamico apenas no
   * Azure SQL DB (engineedition = 9). Nas edicoes simuladas (2/3/4) a tabela
   * permanece vazia e o SELECT final devolve DataRetentionEnabled = 0.
   * @private
   */
  _removerShimDataRetention(sql) {
    if (!/#temp_data_retention(?:_table)?_property\b/i.test(sql)) return sql;

    // Remove o bloco IF ... EXEC sp_executesql que so preenche a tabela no
    // Azure SQL DB (engineedition = 9). Nas edicoes simuladas ela fica vazia.
    let resultado = sql.replace(
      /\bIF\s+(?:EXISTS\s*)?\(?\s*serverproperty\s*\(\s*N?['"]engineedition['"]\s*\)\s*=\s*9\s*\)?\s*\r?\n[ \t]*EXEC(?:UTE)?\s+(?:sys\.)?sp_executesql\s+N?'(?:''|[^'])*'\s*;?/gi,
      ''
    );

    // CROSS APPLY nao existe no SQLite. Como o simulador nao registra tabelas
    // ledger, a tabela temporaria de colunas pode permanecer vazia.
    resultado = resultado.replace(
      /\bINSERT\s+INTO\s+#tmp_ledger_view_column_names\b[\s\S]*?\bGROUP\s+BY\s+x\.t_obj_id\s*/gi,
      ';\r\n'
    );

    // Formato antigo do batch: depois de remover o IF/EXEC, tudo que vem antes
    // do SELECT final depende apenas de DMVs ausentes e pode ser descartado.
    const fimAntigo = resultado.search(
      /\bSELECT\s+dtb\.is_ansi_null_default_on\s+AS\s+\[AnsiNullDefault\]/i
    );
    if (fimAntigo >= 0) {
      const criacao = resultado
        .slice(0, fimAntigo)
        .trim()
        .replace(/\bCREATE\s+TABLE\b/i, (correspondencia) => `${correspondencia} IF NOT EXISTS`);
      return `${criacao}; ${resultado.slice(fimAntigo)}`;
    }

    // O SMO 19 separa as instrucoes apenas por quebras de linha. O SQLite exige
    // ';' para distinguir CREATE/INSERT/SELECT/DROP dentro do mesmo lote.
    resultado = resultado.replace(
      /\r?\n[ \t]*(?=(?:CREATE\s+TABLE\s+#|INSERT\s+INTO\s+#|DROP\s+TABLE\s+#)\b)/gi,
      ';\n'
    );
    resultado = resultado.replace(
      /\r?\n[ \t]*(?=SELECT\s*\r?\n\s*CAST\s*\(\s*\r?\n?\s*serverproperty\s*\(\s*N?['"]Servername['"])/i,
      ';\n'
    );

    // Uma execucao interrompida pode deixar as temporarias no arquivo SQLite;
    // IF NOT EXISTS torna a repeticao do batch inofensiva.
    resultado = resultado.replace(
      /\bCREATE\s+TABLE\s+(#(?:temp_data_retention_table_property|external_data|tmp_ledger_details|tmp_ledger_view_column_names))\b/gi,
      (correspondencia, nome) => `CREATE TABLE IF NOT EXISTS ${nome}`
    );
    return resultado;
  }

  /**
   * sys.tables, sys.indexes e afins sao locais ao database no SQL Server. O
   * catalogo dessas views fica no arquivo atual (main), enquanto sys.databases
   * e as demais tabelas de instancia continuam no database master anexado.
   * @private
   */
  _traduzirCatalogoLocal(sql) {
    const semFuncao = sql.replace(
      /\bsys\s*\.\s*fn_varbintohexsubstring\b/gi,
      'fn_varbintohexsubstring'
    );
    const objetos = [
      'tables', 'all_views', 'views', 'system_views', 'synonyms', 'objects',
      'all_objects', 'indexes',
      'data_spaces', 'filegroups', 'database_files', 'all_columns', 'columns',
      'types', 'database_principals',
      'sql_modules', 'system_sql_modules', 'all_sql_modules', 'extended_properties',
      'default_constraints', 'check_constraints', 'edge_constraints',
      'index_resumable_operations', 'index_columns', 'computed_columns',
      'identity_columns', 'foreign_keys', 'foreign_key_columns', 'column_encryption_keys',
      'xml_schema_collections', 'sensitivity_classifications',
      'change_tracking_tables', 'filetables', 'periods',
      'remote_data_archive_tables', 'external_tables',
      'external_data_sources', 'external_file_formats', 'partitions', 'masked_columns',
      'filetable_system_defined_objects', 'spatial_index_tessellations',
      'spatial_indexes', 'hash_indexes', 'xml_indexes', 'selective_xml_index_paths',
      'stats', 'key_constraints', 'fulltext_indexes', 'fulltext_catalogs',
      'fulltext_stoplists', 'registered_search_property_lists', 'fulltext_index_columns', 'schemas',
      'all_parameters', 'parameters', 'triggers', 'database_permissions',
      'procedures', 'numbered_procedures', 'assemblies', 'assembly_modules',
      'table_types', 'assembly_types'
    ].join('|');
    return semFuncao.replace(
      new RegExp(`\\bsys\\s*\\.\\s*(${objetos})\\b`, 'gi'),
      (_correspondencia, nome) => `main.${nome}`
    );
  }

  /**
   * Aplica a primeira ocorrência de um padrão encontrado na máscara, devolvendo
   * uma nova string. A função de substituição recebe também os índices originais.
   * @private
   */
  _substituirTodos(sql, fonteRegex, substituir, usarNoStrings = false) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 500; tentativa += 1) {
      const máscara = this._mascarar(resultado);
      const texto = usarNoStrings ? máscara.noStrings : máscara.code;
      const correspondência = new RegExp(fonteRegex, 'i').exec(texto);
      if (!correspondência) {
        break;
      }
      const início = correspondência.index;
      const fim = início + correspondência[0].length;
      const novo = substituir(
        correspondência,
        resultado.slice(início, fim),
        texto,
        início,
        fim
      );
      resultado = resultado.slice(0, início) + novo + resultado.slice(fim);
    }

    return resultado;
  }

  /** Encontra o parêntese que fecha o parêntese aberto em `abertura`. @private */
  _parenCorespondente(código, abertura) {
    let profundidade = 0;
    for (let i = abertura; i < código.length; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')') {
        profundidade -= 1;
        if (profundidade === 0) {
          return i;
        }
      }
    }
    return -1;
  }

  /** Divide o conteúdo entre parênteses em argumentos de nível superior. @private */
  _argumentos(código, abertura, fechamento) {
    const argumentos = [];
    let profundidade = 0;
    let início = abertura + 1;

    for (let i = abertura + 1; i < fechamento; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')') {
        profundidade -= 1;
      } else if (código[i] === ',' && profundidade === 0) {
        argumentos.push({ início, fim: i });
        início = i + 1;
      }
    }
    argumentos.push({ início, fim: fechamento });

    return argumentos;
  }

  /** Divide uma lista por vírgulas de nível superior. @private */
  _dividirLista(texto) {
    const máscara = this._mascarar(texto);
    const partes = [];
    let profundidade = 0;
    let início = 0;

    for (let i = 0; i < texto.length; i += 1) {
      if (máscara.code[i] === '(') {
        profundidade += 1;
      } else if (máscara.code[i] === ')') {
        profundidade -= 1;
      } else if (máscara.code[i] === ',' && profundidade === 0) {
        partes.push(texto.slice(início, i));
        início = i + 1;
      }
    }
    partes.push(texto.slice(início));

    return partes.map((parte) => parte.trim()).filter((parte) => parte.length > 0);
  }

  /** Intervalos das instruções separadas por ponto e vírgula de nível superior. @private */
  _segmentosInstrucoes(código) {
    const segmentos = [];
    let profundidade = 0;
    let início = 0;

    for (let i = 0; i < código.length; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')') {
        profundidade -= 1;
      } else if (código[i] === ';' && profundidade === 0) {
        segmentos.push({ início, fim: i + 1 });
        início = i + 1;
      }
    }
    if (início < código.length) {
      segmentos.push({ início, fim: código.length });
    }

    return segmentos;
  }

  /** Cria um erro com código BadRequestException e mensagem em português. @private */
  _badRequest(mensagem) {
    const erro = new Error(mensagem);
    erro.code = 'BadRequestException';
    return erro;
  }

  /**
   * Expande o batch de descoberta de versão do SSMS em lotes independentes.
   *
   * A consulta original devolve três conjuntos de resultado (versão/edição,
   * host_platform e ConnectionProtocol). A camada TDS separa result sets por
   * lote, então devolvemos um SELECT por lote — se tudo vier em um único
   * resultset, o SSMS falha com "Cannot find table 2" ao ligar ao servidor.
   *
   * @param {string} sql
   * @returns {string[]|null} lotes já prontos, ou null quando não é o padrão
   */
  expandirResultSets(sql) {
    if (typeof sql !== 'string') {
      return null;
    }

    const código = this._mascarar(sql).code;
    if (
      !/\bDECLARE\s+@edition\s+sysname\b/i.test(código) ||
      !/\bSERVERPROPERTY\b/i.test(código) ||
      !/\bCONNECTIONPROPERTY\b/i.test(sql) ||
      !/\bMICROSOFTVERSION\b/i.test(código)
    ) {
      return null;
    }

    return [
      'SELECT 1 AS [DatabaseEngineType], 2 AS [DatabaseEngineEdition], ' +
        "'16.00.4035.2' AS [ProductVersion], 16 AS [MicrosoftVersion]",
      "SELECT 'Windows' AS [host_platform]",
      "SELECT 'TCP' AS [ConnectionProtocol]"
    ];
  }

  /**
   * Tipos TDS que o SMO espera nas colunas dos shims acima. O SQLite descarta
   * o tipo declarado de expressões calculadas (CAST inclusive), então sem isso
   * colunas BIT/TINYINT chegam como INT e o Explorer falha com
   * "Specified cast is not valid" ao ler bools com GetBoolean().
   *
   * @param {string} sql SQL bruto recebido do cliente
   * @returns {Object<string,string>|null} mapa nome da coluna → tipo declarado
   */
  columnTypesFor(sql) {
    if (typeof sql !== 'string') return null;

    const código = this._mascarar(sql).code;

    // O SMO le cada opcao do usuario com GetBoolean(); sem o tipo TDS
    // explicito as colunas chegam como INTN e o Script() estoura cast.
    if (/\bdeclare\s+@UserOption\b/i.test(sql) && /\bAnsiNulls\b/i.test(sql)) {
      const tipos = {};
      for (const nome of [
        'DisableDefaultConstraintCheck', 'ImplicitTransactions', 'CursorCloseOnCommit',
        'AnsiWarnings', 'AnsiPadding', 'AnsiNulls', 'AbortOnArithmeticErrors',
        'IgnoreArithmeticErrors', 'QuotedIdentifier', 'NoCount', 'AnsiNullDefaultOn',
        'AnsiNullDefaultOff', 'ConcatenateNullYieldsNull', 'NumericRoundAbort',
        'AbortTransactionOnError'
      ]) {
        tipos[nome] = 'BIT';
      }
      return tipos;
    }

    // O SMO le as opcoes de Query Store com GetByte/GetInt16/GetInt64; sem os
    // tipos TDS explicitos o SQLite devolve INTN e o script do database falha.
    if (/\bdatabase_query_store_options\b/i.test(sql)) {
      return {
        ActualState: 'TINYINT',
        DesiredState: 'TINYINT',
        ReadOnlyReason: 'INT',
        CurrentStorageSizeInMB: 'BIGINT',
        MaxStorageSizeInMB: 'BIGINT',
        StaleQueryThresholdInDays: 'INT',
        DataFlushIntervalInSeconds: 'INT',
        StatisticsCollectionIntervalInMinutes: 'INT',
        QueryCaptureMode: 'TINYINT',
        SizeBasedCleanupMode: 'TINYINT',
        MaxPlansPerQuery: 'INT',
        WaitStatsCaptureMode: 'TINYINT',
        CapturePolicyExecutionCount: 'INT',
        CapturePolicyTotalCompileCpuTimeInMS: 'BIGINT',
        CapturePolicyTotalExecutionCpuTimeInMS: 'BIGINT',
        CapturePolicyStaleThresholdInHrs: 'INT'
      };
    }

    // sys.numbered_procedures.procedure_number e SMALLINT no SQL Server. O
    // SSMS le essa coluna com GetInt16(); sem o tipo explicito o TDS chega
    // como INTN de 4 bytes e o script de "Modify" falha com
    // "Specified cast is not valid" (Microsoft.SqlServer.SqlEnum).
    if (/\bnumbered_procedures\b/i.test(sql)) {
      return { Number: 'SMALLINT' };
    }

    // Batch de propriedades do database (#tempbackup): o SQLite nao preserva
    // CAST/DECLARE, então declara-se tipo por tipo para o SMO nao estourar
    // "Specified cast is not valid" ao ler bools, datas, floats e GUIDs.
    if (/\bcreate\s+table\s+#tempbackup\b/i.test(sql)) {
      return {
        Name: 'TEXT',
        ID: 'INT',
        Status: 'INT',
        Owner: 'TEXT',
        PrimaryFilePath: 'TEXT',
        UserName: 'TEXT',
        DatabaseName: 'TEXT',
        DatabaseName2: 'TEXT',
        DatabaseName3: 'TEXT',
        DatabaseName4: 'TEXT',
        DatabaseName5: 'TEXT',
        DatabaseName6: 'TEXT',
        Collation: 'TEXT',
        DefaultFileGroup: 'TEXT',
        DefaultSchema: 'TEXT',
        DefaultFullTextCatalog: 'TEXT',
        DatabaseSnapshotBaseName: 'TEXT',
        MirroringPartner: 'TEXT',
        MirroringPartnerInstance: 'TEXT',
        MirroringWitness: 'TEXT',
        DefaultFileStreamFileGroup: 'TEXT',
        FilestreamDirectoryName: 'TEXT',
        RemoteDataArchiveCredential: 'TEXT',
        RemoteDataArchiveEndpoint: 'TEXT',
        RemoteDataArchiveLinkedServer: 'TEXT',
        RemoteDatabaseName: 'TEXT',
        PersistentVersionStoreFileGroup: 'TEXT',
        DatabaseGuid: 'UNIQUEIDENTIFIER',
        MirroringID: 'UNIQUEIDENTIFIER',
        RecoveryForkGuid: 'UNIQUEIDENTIFIER',
        ServiceBrokerGuid: 'UNIQUEIDENTIFIER',
        CreateDate: 'DATETIME',
        LastBackupDate: 'DATETIME',
        LastDifferentialBackupDate: 'DATETIME',
        LastGoodCheckDbTime: 'DATETIME',
        LastLogBackupDate: 'DATETIME',
        DataSpaceUsage: 'FLOAT',
        IndexSpaceUsage: 'FLOAT',
        Size: 'FLOAT',
        SpaceAvailable: 'FLOAT',
        MemoryAllocatedToMemoryOptimizedObjectsInKB: 'FLOAT',
        MemoryUsedByMemoryOptimizedObjectsInKB: 'FLOAT',
        PersistentVersionStoreSizeKB: 'FLOAT',
        MirroringFailoverLogSequenceNumber: 'BIGINT',
        MirroringRedoQueueMaxSize: 'BIGINT',
        MirroringRoleSequence: 'BIGINT',
        MirroringSafetySequence: 'BIGINT',
        MirroringTimeout: 'INT',
        CompatibilityLevel: 'INT',
        ActiveConnections: 'INT',
        ReplicationOptions: 'INT',
        Version: 'INT',
        LogReuseWaitStatus: 'INT',
        MirroringRole: 'INT',
        MirroringSafetyLevel: 'INT',
        MirroringStatus: 'INT',
        MirroringWitnessStatus: 'INT',
        SnapshotIsolationState: 'INT',
        ChangeTrackingRetentionPeriod: 'INT',
        ChangeTrackingRetentionPeriodUnits: 'TINYINT',
        FilestreamNonTransactedAccess: 'INT',
        TargetRecoveryTime: 'INT',
        TwoDigitYearCutoff: 'INT',
        DelayedDurability: 'TINYINT',
        LegacyCardinalityEstimation: 'INT',
        LegacyCardinalityEstimationForSecondary: 'INT',
        MaxDop: 'INT',
        MaxDopForSecondary: 'INT',
        ParameterSniffing: 'INT',
        ParameterSniffingForSecondary: 'INT',
        QueryOptimizerHotfixes: 'INT',
        QueryOptimizerHotfixesForSecondary: 'INT',
        CatalogCollation: 'INT',
        PolicyHealthState: 'INT',
        AvailabilityDatabaseSynchronizationState: 'INT',
        ContainmentType: 'INT',
        ContainmentType2: 'INT',
        DefaultFullTextLanguageLcid: 'INT',
        DefaultLanguageLcid: 'INT',
        RemoteDataArchiveUseFederatedServiceAccount: 'BIT',
        HasFileInCloud: 'BIT',
        HasMemoryOptimizedObjects: 'BIT',
        AutoClose: 'BIT',
        AutoShrink: 'BIT',
        DboLogin: 'BIT',
        IsAccessible: 'BIT',
        IsDbAccessAdmin: 'BIT',
        IsDbBackupOperator: 'BIT',
        IsDbDatareader: 'BIT',
        IsDbDatawriter: 'BIT',
        IsDbDdlAdmin: 'BIT',
        IsDbDenyDatareader: 'BIT',
        IsDbDenyDatawriter: 'BIT',
        IsDbOwner: 'BIT',
        IsDbSecurityAdmin: 'BIT',
        IsFullTextEnabled: 'BIT',
        IsMirroringEnabled: 'BIT',
        IsSqlDw: 'BIT',
        IsSystemObject: 'BIT',
        AnsiNullDefault: 'BIT',
        AnsiNullsEnabled: 'BIT',
        AnsiPaddingEnabled: 'BIT',
        AnsiWarningsEnabled: 'BIT',
        ArithmeticAbortEnabled: 'INT',
        AutoCreateStatisticsEnabled: 'BIT',
        AutoUpdateStatisticsEnabled: 'BIT',
        CaseSensitive: 'BIT',
        CloseCursorsOnCommitEnabled: 'BIT',
        ConcatenateNullYieldsNull: 'BIT',
        DatabaseOwnershipChaining: 'BIT',
        IsUpdateable: 'BIT',
        LocalCursorsDefault: 'INT',
        NumericRoundAbortEnabled: 'BIT',
        PageVerify: 'INT',
        QuotedIdentifiersEnabled: 'BIT',
        ReadOnly: 'BIT',
        RecoveryModel: 'INT',
        RecursiveTriggersEnabled: 'BIT',
        UserAccess: 'INT',
        AutoUpdateStatisticsAsync: 'BIT',
        BrokerEnabled: 'INT',
        DateCorrelationOptimization: 'INT',
        HasFullBackup: 'BIT',
        IsDatabaseSnapshot: 'BIT',
        IsDatabaseSnapshotBase: 'BIT',
        IsMailHost: 'BIT',
        IsParameterizationForced: 'BIT',
        IsReadCommittedSnapshotOn: 'BIT',
        IsVarDecimalStorageFormatEnabled: 'BIT',
        Trustworthy: 'BIT',
        ChangeTrackingAutoCleanUp: 'BIT',
        ChangeTrackingEnabled: 'BIT',
        EncryptionEnabled: 'BIT',
        HasDatabaseEncryptionKey: 'BIT',
        HonorBrokerPriority: 'BIT',
        IsManagementDataWarehouse: 'BIT',
        DefaultFullTextLanguageName: 'INT',
        DefaultLanguageName: 'INT',
        NestedTriggersEnabled: 'BIT',
        TransformNoiseWords: 'BIT',
        AutoCreateIncrementalStatisticsEnabled: 'BIT',
        RemoteDataArchiveEnabled: 'BIT',
        AcceleratedRecoveryEnabled: 'BIT',
        IsLedger: 'BIT',
      };
    }

    // Diversas propriedades sao lidas pelo SMO com tipos especificos. Essas
    // regras precisam vir ANTES das regras genericas de sys.databases e
    // sys.filegroups, que casam primeiro e nao incluem essas colunas.
    if (/\bNumberOfDisk(?:Reads|Writes)\b/i.test(sql)) {
      const tipos = {};
      if (/\bNumberOfDiskReads\b/i.test(sql)) tipos.NumberOfDiskReads = 'BIGINT';
      if (/\bNumberOfDiskWrites\b/i.test(sql)) tipos.NumberOfDiskWrites = 'BIGINT';
      return tipos;
    }
    if (/\bVolumeFreeSpace\b/i.test(sql)) {
      return { VolumeFreeSpace: 'BIGINT' };
    }
    if (/\bfreebytes\b/i.test(sql)) {
      return { freebytes: 'BIGINT' };
    }
    if (/\bIsDatabaseSnapshotBase\b/i.test(sql)) {
      return { IsDatabaseSnapshotBase: 'BIT' };
    }
    if (/\bMirroringID\b/i.test(sql)) {
      return { MirroringID: 'UNIQUEIDENTIFIER' };
    }

    // IsXTPSupported vem de SERVERPROPERTY/CASE como INT no SQLite; o SMO le
    // essa propriedade com GetBoolean() e estoura "Specified cast is not valid".
    if (/\bIsXTPSupported\b/i.test(sql)) {
      return { IsXTPSupported: 'BIT' };
    }

    // Colunas de um indice. Sem tipos explicitos a regra de propriedades de
    // tabela casa primeiro e o SMO recebe IsIncluded/Descending como INTN,
    // descartando a coluna e deixando Table.PrimaryKey nulo.
    if (/\bIndex_Name\b/i.test(sql) && /\bIsIncluded\b/i.test(sql) && /\bindex_columns\b/i.test(sql)) {
      return {
        Server_Name: 'TEXT',
        Database_Name: 'TEXT',
        Table_Schema: 'TEXT',
        Table_Name: 'TEXT',
        Index_Name: 'TEXT',
        ID: 'INT',
        Name: 'TEXT',
        IsIncluded: 'BIT',
        Descending: 'BIT',
        IsComputed: 'BIT',
        ColumnStoreOrderOrdinal: 'INT'
      };
    }

    // Query de propriedades de um indice unico (abre o no Keys/Constraints do
    // Object Explorer). O SMO le HasSparseColumn/HasFilter/IsPartitioned como
    // Boolean e ResumableOperationState como byte; sem tipos explicitos o
    // SQLite devolve INTN e o SMO falha ao carregar a PrimaryKey.
    if (/\bResumableOperationState\b/i.test(sql) && /\bindex_resumable_operations\b/i.test(sql)) {
      return {
        Name: 'TEXT',
        ID: 'INT',
        IsSystemObject: 'BIT',
        NoAutomaticRecomputation: 'BIT',
        FillFactor: 'TINYINT',
        IsClustered: 'BIT',
        IndexKeyType: 'INT',
        IsUnique: 'BIT',
        IgnoreDuplicateKeys: 'BIT',
        DisallowRowLocks: 'BIT',
        DisallowPageLocks: 'BIT',
        PadIndex: 'BIT',
        IsDisabled: 'BIT',
        IsSystemNamed: 'BIT',
        IsFullTextKey: 'BIT',
        IsXmlIndex: 'BIT',
        SecondaryXmlIndexType: 'TINYINT',
        ParentXmlIndex: 'TEXT',
        SpatialIndexType: 'TINYINT',
        BoundingBoxXMin: 'FLOAT',
        BoundingBoxYMin: 'FLOAT',
        BoundingBoxXMax: 'FLOAT',
        BoundingBoxYMax: 'FLOAT',
        Level1Grid: 'SMALLINT',
        Level2Grid: 'SMALLINT',
        Level3Grid: 'SMALLINT',
        Level4Grid: 'SMALLINT',
        CellsPerObject: 'INT',
        IsSpatialIndex: 'BIT',
        HasSparseColumn: 'BIT',
        HasFilter: 'BIT',
        FilterDefinition: 'TEXT',
        PartitionScheme: 'TEXT',
        IsPartitioned: 'BIT',
        FileStreamFileGroup: 'TEXT',
        FileStreamPartitionScheme: 'TEXT',
        IsFileTableDefined: 'BIT',
        IndexType: 'TINYINT',
        BucketCount: 'INT',
        CompressionDelay: 'INT',
        IndexedXmlPathName: 'TEXT',
        ResumableOperationState: 'TINYINT',
        IsOptimizedForSequentialKey: 'BIT'
      };
    }

    // O SMO le os metadados de indices com tipos explicitos (BIT/TINYINT/
    // SMALLINT/INT/FLOAT). Sem isso o SQLite devolve INTN e o Script() da
    // tabela com primary key estoura "Specified cast is not valid".
    if (/\bDisallowPageLocks\b/i.test(sql) && /\bBoundingBoxXMax\b/i.test(sql)) {
      return {
        Name: 'TEXT',
        BoundingBoxXMax: 'FLOAT',
        BoundingBoxXMin: 'FLOAT',
        BoundingBoxYMax: 'FLOAT',
        BoundingBoxYMin: 'FLOAT',
        BucketCount: 'INT',
        CellsPerObject: 'INT',
        CompressionDelay: 'INT',
        DisallowPageLocks: 'BIT',
        DisallowRowLocks: 'BIT',
        FileGroup: 'TEXT',
        FileStreamFileGroup: 'TEXT',
        FileStreamPartitionScheme: 'TEXT',
        FillFactor: 'TINYINT',
        FilterDefinition: 'TEXT',
        IgnoreDuplicateKeys: 'BIT',
        IndexedXmlPathName: 'TEXT',
        IndexKeyType: 'INT',
        IndexType: 'TINYINT',
        IsClustered: 'BIT',
        IsDisabled: 'BIT',
        IsFileTableDefined: 'BIT',
        IsSystemNamed: 'BIT',
        IsSystemObject: 'BIT',
        IsUnique: 'BIT',
        Level1Grid: 'SMALLINT',
        Level2Grid: 'SMALLINT',
        Level3Grid: 'SMALLINT',
        Level4Grid: 'SMALLINT',
        NoAutomaticRecomputation: 'BIT',
        PadIndex: 'BIT',
        ParentXmlIndex: 'TEXT',
        PartitionScheme: 'TEXT',
        SecondaryXmlIndexType: 'TINYINT',
        SpatialIndexType: 'TINYINT',
        IsOptimizedForSequentialKey: 'BIT',
        HasXmlCompressedPartitions: 'BIT'
      };
    }

    // O SMO le HasCompressedPartitions com GetBoolean(); sem tipo TDS explicito
    // o SQLite devolve INTN e o Script() da tabela estoura InvalidCastException.
    if (/\bHasCompressedPartitions\b/i.test(sql)) {
      return {
        Server_Name: 'TEXT',
        Database_Name: 'TEXT',
        Schema: 'TEXT',
        Name: 'TEXT',
        HasCompressedPartitions: 'BIT'
      };
    }

    // Mesmo padrao de HasCompressedPartitions: o SMO le com GetBoolean().
    if (/\bHasXmlCompressedPartitions\b/i.test(sql)) {
      return { HasXmlCompressedPartitions: 'BIT' };
    }

    // PhysicalMemoryUsageInKB e lido pelo SMO como Int64; o SELECT devolve INT
    // do SQLite, que chega como Int32 e quebra o cast.
    if (/\bPhysicalMemoryUsageInKB\b/i.test(sql)) {
      return { PhysicalMemoryUsageInKB: 'BIGINT' };
    }

    // O getter de Database.Size do SMO faz varias consultas auxiliares. O SUM
    // no SQLite devolve 0 como Int32, mas o SMO chama GetDouble(); sem o tipo
    // explicito o cast estoura "Specified cast is not valid".
    if (/\b(?:DbSize|LogSize|SpaceAvailable|DataSpaceUsage|IndexSpaceUsage)\b/i.test(sql)) {
      return {
        DbSize: 'FLOAT',
        LogSize: 'FLOAT',
        SpaceAvailable: 'FLOAT',
        DataSpaceUsage: 'FLOAT',
        IndexSpaceUsage: 'FLOAT'
      };
    }

    // No SQL Server, IsSingleUser/IsXTPSupported/IsFullTextInstalled e
    // IsContainedAuthentication vêm de SERVERPROPERTY/CASE como INT — forçar
    // BIT aqui faria o SMO lançar "Specified cast is not valid" ao ler Int32.

    if (/\bLOGINPROPERTY\b/i.test(sql) && /\bsys\.server_principals\b/i.test(sql)) {
      return {
        DenyWindowsLogin: 'BIT',
        HasAccess: 'BIT',
        IsLocked: 'BIT',
        IsPasswordExpired: 'BIT',
        MustChangePassword: 'BIT',
        IsDisabled: 'BIT',
        IsSystemObject: 'BIT',
        PasswordExpirationEnabled: 'BIT',
        PasswordPolicyEnforced: 'BIT',
        LoginType: 'INT',
        WindowsLoginAccessType: 'INT',
        PasswordHashAlgorithm: 'INT',
        CreateDate: 'DATETIME',
        DateLastModified: 'DATETIME'
      };
    }

    // O SMO le as colunas booleanas de check/foreign_keys com GetBoolean; sem
    // os tipos TDS explicitos o SQLite devolve INTN e o script da tabela falha.
    if (/\b(?:sys|main)\.(?:check_constraints|foreign_keys)\b/i.test(sql)) {
      return {
        NotForReplication: 'BIT',
        IsChecked: 'BIT',
        IsEnabled: 'BIT',
        IsSystemNamed: 'BIT',
        IsFileTableDefined: 'BIT',
        DeleteAction: 'TINYINT',
        UpdateAction: 'TINYINT'
      };
    }

    // A query de colunas do Object Explorer e do Script() referencia
    // foreign_key_columns em subconsulta, mas tambem le all_columns. A regra
    // de all_columns deve vir primeiro para nao devolver apenas ID:INT e
    // deixar Nullable/Computed/IsForeignKey sem tipo BIT (cast invalido).
    if (/\b(?:sys|main)\.all_columns\b/i.test(sql) && /\bas\s+\[DataType\]/i.test(sql)) {
      return {
        ID: 'INT',
        Nullable: 'BIT',
        Computed: 'BIT',
        InPrimaryKey: 'BIT',
        AnsiPaddingStatus: 'BIT',
        RowGuidCol: 'BIT',
        IsPersisted: 'BIT',
        IsForeignKey: 'BIT',
        Identity: 'BIT',
        IdentitySeedAsDecimal: 'DECIMAL(38,0)',
        IdentityIncrementAsDecimal: 'DECIMAL(38,0)',
        IsDeterministic: 'BIT',
        IsPrecise: 'BIT',
        NotForReplication: 'BIT',
        IsFullTextIndexed: 'BIT',
        StatisticalSemantics: 'INT',
        EncryptionType: 'INT',
        ColumnEncryptionKeyID: 'INT',
        IsFileStream: 'BIT',
        IsSparse: 'BIT',
        IsColumnSet: 'BIT',
        Length: 'INT',
        NumericPrecision: 'INT',
        NumericScale: 'INT',
        XmlDocumentConstraint: 'INT',
        GeneratedAlwaysType: 'TINYINT',
        IsHidden: 'BIT',
        IsDroppedLedgerColumn: 'BIT',
        IsMasked: 'BIT',
        IsClassified: 'BIT',
        GraphType: 'INT'
      };
    }

    if (/\b(?:sys|main)\.foreign_key_columns\b/i.test(sql)) {
      return {
        ID: 'INT'
      };
    }

    // O SSMS le IsEncrypted/IsSchemaBound como Boolean e LedgerViewType como
    // Byte. Sem o tipo explicito o SQLite devolve INTN e o SMO estoura cast.
    if (
      /\b(?:sys|main)\.(?:all_views|system_views|views)\b/i.test(sql) &&
      /\bIsEncrypted\b/i.test(sql)
    ) {
      return {
        IsEncrypted: 'BIT',
        IsSchemaBound: 'BIT',
        AnsiNullsStatus: 'BIT',
        HasColumnSpecification: 'BIT',
        IsSystemObject: 'BIT',
        IsSchemaOwned: 'BIT',
        QuotedIdentifierStatus: 'BIT',
        ReturnsViewMetadata: 'BIT',
        HasAfterTrigger: 'BIT',
        HasInsertTrigger: 'BIT',
        HasDeleteTrigger: 'BIT',
        HasInsteadOfTrigger: 'BIT',
        HasUpdateTrigger: 'BIT',
        HasIndex: 'BIT',
        IsIndexable: 'BIT',
        HasNonClusteredIndex: 'BIT',
        HasClusteredIndex: 'BIT',
        HasPrimaryClusteredIndex: 'BIT',
        DateLastModified: 'DATETIME',
        LedgerViewType: 'TINYINT',
        IsDroppedLedgerView: 'BIT',
        CreateDate: 'DATETIME'
      };
    }

    // A lista de Stored Procedures e Functions do Object Explorer consulta
    // sys.all_objects (nao sys.procedures) e le IsEncrypted/
    // IsNativelyCompiled com GetBoolean(). Sem o tipo TDS explicito o SSMS
    // fecha com InvalidCastException em StoredProcedure.GetIconName().
    if (
      /\b(?:sys|main)\.all_objects\b/i.test(sql) &&
      /\b(?:IsEncrypted|IsNativelyCompiled)\b/i.test(sql)
    ) {
      return {
        IsEncrypted: 'BIT',
        IsNativelyCompiled: 'BIT',
        ImplementationType: 'INT',
        FunctionType: 'INT',
        CreateDate: 'DATETIME',
        IsSchemaOwned: 'BIT',
        IsSystemObject: 'BIT',
        AnsiNullsStatus: 'BIT',
        QuotedIdentifierStatus: 'BIT',
        IsSchemaBound: 'BIT',
        ReturnsNullOnNullInput: 'BIT',
        IsDeterministic: 'BIT',
        IsInlineable: 'BIT',
        Recompile: 'BIT',
        Startup: 'BIT',
        ForReplication: 'BIT',
        InlineType: 'TINYINT',
        XmlDocumentConstraint: 'TINYINT'
      };
    }

    if (/\b(?:sys|main)\.procedures\b/i.test(sql)) {
      return {
        IsMSShipped: 'BIT',
        IsMsShipped: 'BIT',
        IsSystemObject: 'BIT',
        IsPublished: 'BIT',
        IsSchemaPublished: 'BIT',
        CreateDate: 'DATETIME',
        ModifyDate: 'DATETIME'
      };
    }

    if (/\b(?:sys|main)\.(?:tables|all_views|views)\b/i.test(sql)) {
      return {
        ID: 'INT',
        CreateDate: 'DATETIME',
        DateLastModified: 'DATETIME',
        IsSchemaOwned: 'BIT',
        IsMemoryOptimized: 'BIT',
        IsSystemObject: 'BIT',
        HasAfterTrigger: 'BIT',
        HasInsertTrigger: 'BIT',
        HasDeleteTrigger: 'BIT',
        HasInsteadOfTrigger: 'BIT',
        HasUpdateTrigger: 'BIT',
        HasIndex: 'BIT',
        IsIndexable: 'BIT',
        HasClusteredIndex: 'BIT',
        HasNonClusteredIndex: 'BIT',
        HasPrimaryClusteredIndex: 'BIT',
        HasNonClusteredColumnStoreIndex: 'BIT',
        HasClusteredColumnStoreIndex: 'BIT',
        HasXmlIndex: 'BIT',
        HasHeapIndex: 'BIT',
        HasXmlData: 'BIT',
        HasSpatialData: 'BIT',
        AnsiNullsStatus: 'BIT',
        QuotedIdentifierStatus: 'BIT',
        FakeSystemTable: 'BIT',
        Durability: 'TINYINT',
        Replicated: 'BIT',
        LockEscalation: 'TINYINT',
        ChangeTrackingEnabled: 'BIT',
        TrackColumnsUpdatedEnabled: 'BIT',
        IsLedger: 'BIT',
        LedgerType: 'INT',
        IsDroppedLedgerTable: 'BIT',
        IsSystemVersioned: 'BIT',
        IsFileTable: 'BIT',
        FileTableNamespaceEnabled: 'BIT',
        IsPartitioned: 'BIT',
        HistoryTableID: 'INT',
        HasSystemTimePeriod: 'BIT',
        TemporalType: 'TINYINT',
        RemoteDataArchiveEnabled: 'BIT',
        RemoteDataArchiveDataMigrationState: 'TINYINT',
        RemoteTableProvisioned: 'BIT',
        IsNode: 'BIT',
        IsEdge: 'BIT',
        IsExternal: 'BIT',
        HasSparseColumn: 'BIT',
        IsEncrypted: 'BIT',
        IsSchemaBound: 'BIT'
      };
    }

    if (
      /\bIS_SRVROLEMEMBER\b/i.test(sql) &&
      /\bAdminConnection\b/i.test(sql) &&
      /\bSmoEnabled\b/i.test(sql)
    ) {
      return { AdminConnection: 'BIT', SmoEnabled: 'BIT' };
    }

    // Aba Filegroups do New Database: o SMO le IsDefault/IsOffline/IsSparse
    // com GetBoolean() e Size/Growth com GetDouble(). Sem os tipos TDS
    // explicitos o SQLite devolve INT e o SMO estoura "Specified cast is
    // not valid".
    const ehFilegroups = /\b(?:sys|main)\.filegroups\b/i.test(sql);
    // O SSMS tambem envia uma query isolada so com [Size] para somar o tamanho
    // do log. Sem o tipo explicito o SQLite devolve INTN e o GetDouble() do
    // SMO estoura "Specified cast is not valid".
    const ehArquivos = /\b(?:sys|main)\.database_files\b/i.test(sql) &&
      /\[(?:IsPrimaryFile|UsedSpace|GrowthType|Size|MaxSize|Growth|IsReadOnlyMedia|IsOffline|IsSparse)\]/i.test(sql);
    if (ehFilegroups || ehArquivos) {
      return {
        Name: 'TEXT',
        ID: 'INT',
        IsDefault: 'BIT',
        ReadOnly: 'BIT',
        Size: 'FLOAT',
        FileGroupType: 'INT',
        IsFileStream: 'BIT',
        PolicyHealthState: 'INT',
        AutogrowAllFiles: 'BIT',
        FileName: 'TEXT',
        UsedSpace: 'FLOAT',
        GrowthType: 'INT',
        MaxSize: 'FLOAT',
        Growth: 'FLOAT',
        IsReadOnlyMedia: 'BIT',
        IsReadOnly: 'BIT',
        IsOffline: 'BIT',
        IsSparse: 'BIT',
        IsPrimaryFile: 'BIT'
      };
    }

    if (/\b(?:master\.)?sys\.databases\b/i.test(código)) {
      return {
        // O SMO consulta [Size] isoladamente com CAST(0 AS float); sem o tipo
        // explicito o valor 0 chega como INTN e GetDouble() estoura o cast.
        Size: 'FLOAT',
        State: 'TINYINT',
        Database_Status: 'INT',
        Database_CompatibilityLevel: 'INT',
        Database_IsSqlDw: 'BIT',
        Database_IsFullTextEnabled: 'BIT',
        RecoveryModel: 'TINYINT',
        UserAccess: 'TINYINT',
        ReadOnly: 'BIT',
        IsAccessible: 'BIT'
      };
    }

    if (/\bFROM\s+(?:master\.)?sys\.configurations\b/i.test(código)) {
      return { Dynamic: 'BIT', Advanced: 'BIT' };
    }

    // Batch completo de propriedades do Server: colunas vindas de CAST AS bit.
    if (/\bSmoAuditLevel\b/i.test(sql) && /\bPolicyHealthState\b/i.test(sql)) {
      return {
        ResourceLastUpdateDateTime: 'DATETIME',
        IsCaseSensitive: 'BIT',
        IsFullTextInstalled: 'BIT',
        IsSingleUser: 'BIT',
        IsClustered: 'BIT',
        NamedPipesEnabled: 'BIT',
        TcpEnabled: 'BIT',
        IsHadrEnabled: 'BIT',
        IsPolyBaseInstalled: 'BIT'
      };
    }

    // PolicyStore (Microsoft.SqlServer.Dmf): Enabled/LogOnSuccess sao Boolean.
    // Sem BIT explicito o cliente chama GetBoolean() em INTN e estoura
    // "Specified cast is not valid. (Microsoft.SqlServer.Dmf)".
    if (/\bsyspolicy_configuration\b/i.test(sql)) {
      return {
        Urn: 'TEXT',
        Name: 'TEXT',
        Enabled: 'BIT',
        HistoryRetentionInDays: 'INT',
        LogOnSuccess: 'BIT'
      };
    }

    if (/\bPolicyHealthState\b/i.test(sql)) {
      return { PolicyHealthState: 'INT' };
    }

    // Batch de descoberta do SMO: essas colunas vêm de CAST(... AS bit).
    if (/\bFULLTEXTSERVICEPROPERTY\b/i.test(sql) && /\bIsSingleUser\b/i.test(sql)) {
      return {
        ResourceLastUpdateDateTime: 'DATETIME',
        IsCaseSensitive: 'BIT',
        IsFullTextInstalled: 'BIT',
        IsClustered: 'BIT',
        IsSingleUser: 'BIT',
        IsXTPSupported: 'BIT'
      };
    }

    return null;
  }

  /**
   * Substitui o batch de descoberta de servidor enviado pelo SSMS ao conectar.
   * A consulta original usa xp_msver, tabelas de sistema e funções de servidor
   * que não existem no SQLite. Devolvemos um resultset com as mesmas colunas e
   * valores representativos do cluster simulado.
   * @private
   */
  _traduzirMetadadosCliente(sql) {
    const código = this._mascarar(sql).code;

    // Batch de propriedades do database enviado pelo SMO ao abrir o New
    // Database. Usa tabelas temporarias (#tempbackup), DMVs de HADR e
    // procedimentos internos que nao existem no simulador; o shim abaixo
    // devolve as mesmas colunas lendo os valores reais de sys.databases.
    if (
      /\bcreate\s+table\s+#tempbackup\b/i.test(código) &&
      /\bbackup_finish_date\b/i.test(sql)
    ) {
      // O SMO tambem consulta cada data de backup isoladamente, passando o
      // tipo de backup e o nome do database (2 parametros). O shim completo
      // espera apenas 1 parametro, por isso essas consultas precisam de um
      // resultset proprio com a unica coluna pedida.
      const data = /\bAS\s+\[(Last(?:Backup|DifferentialBackup|Log)Date)\]/i.exec(sql);
      if (data) {
        // Consome os 2 parametros (@_msparam_0 = tipo, @_msparam_1 = database)
        // para o better-sqlite3 nao reclamar "Too many parameter values were
        // provided". O filtro 1=1 garante uma linha com a coluna pedida.
        return `SELECT NULL AS [${data[1]}] FROM (SELECT @_msparam_0 AS [t], @_msparam_1 AS [d]) WHERE 1=1`;
      }
      return SHIM_PROPRIEDADES_DATABASE;
    }

    // Batch de espaco livre em disco enviado pelo SMO ao montar Filegroups.
    // Ele usa IF/ELSE, CROSS APPLY e um EXEC de procedimento ausente; como a
    // edicao simulada e Standard (2), o valor -1 e o retorno correto.
    if (/\bcreate\s+table\s+#tempspace\b/i.test(código)) {
      return 'SELECT -1 AS [freebytes]';
    }

    // Batch completo de propriedades do Server enviado pelo SMO. Ele tambem
    // usa xp_instance_regread e sys.database_files, mas espera colunas como
    // AuditLevel e PolicyHealthState. Devolver o resultset de Information aqui
    // faz o SMO converter os valores por posicao e estourar Int16/enum no
    // Server.Refresh(), que era o travamento do SSMS.
    if (/\bSmoAuditLevel\b/i.test(sql) && /\bPolicyHealthState\b/i.test(sql)) {
      const caminho = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL';
      const colunas = [
        '2 AS [AuditLevel]',
        '12 AS [NumberOfLogFiles]',
        '2 AS [LoginMode]',
        "'' AS [MailProfile]",
        `'${caminho}\\DATA' AS [BackupDirectory]`,
        '1000 AS [PerfMonMode]',
        `'${caminho}' AS [InstallDataDirectory]`,
        "'MSSQLSERVER' AS [ServiceName]",
        `'${caminho}\\Log' AS [ErrorLogPath]`,
        `'${caminho}\\' AS [RootDirectory]`,
        'CAST(0 AS BIT) AS [IsCaseSensitive]',
        '38 AS [MaxPrecision]',
        'CAST(0 AS BIT) AS [IsFullTextInstalled]',
        "'16.00.4035.2' AS [VersionString]",
        "'Standard Edition (64-bit)' AS [Edition]",
        "'RTM' AS [ProductLevel]",
        "'' AS [ProductUpdateLevel]",
        'CAST(0 AS BIT) AS [IsSingleUser]',
        '2 AS [EngineEdition]',
        "'SQL_Latin1_General_CP1_CI_AS' AS [Collation]",
        'CAST(0 AS BIT) AS [IsClustered]',
        "'LOCAL' AS [NetName]",
        "'LOCAL' AS [ComputerNamePhysicalNetBIOS]",
        '2 AS [ServiceStartMode]',
        `'${caminho}\\DATA' AS [MasterDBLogPath]`,
        `'${caminho}\\DATA' AS [MasterDBPath]`,
        `'${caminho}\\DATA' AS [DefaultFile]`,
        `'${caminho}\\DATA' AS [DefaultLog]`,
        "'16.00.4035.2' AS [ResourceVersionString]",
        "'2023-01-01T00:00:00' AS [ResourceLastUpdateDateTime]",
        '0 AS [CollationID]',
        '196609 AS [ComparisonStyle]',
        '1 AS [SqlCharSet]',
        "'ascii' AS [SqlCharSetName]",
        '52 AS [SqlSortOrder]',
        "'nocase_iso' AS [SqlSortOrderName]",
        "'v4.0.30319' AS [BuildClrVersionString]",
        "'' AS [ServiceAccount]",
        'CAST(0 AS BIT) AS [NamedPipesEnabled]',
        'CAST(1 AS BIT) AS [TcpEnabled]',
        "'' AS [InstallSharedDirectory]",
        "'' AS [SqlDomainGroup]",
        '0 AS [PolicyHealthState]',
        '0 AS [FilestreamLevel]',
        "'' AS [FilestreamShareName]",
        '-1 AS [TapeLoadWaitTime]',
        'CAST(0 AS BIT) AS [IsHadrEnabled]',
        '0 AS [HadrManagerStatus]',
        "'' AS [ClusterName]",
        '4 AS [ClusterQuorumType]',
        '3 AS [ClusterQuorumState]',
        'NULL AS [ServiceAccountSid]',
        'CAST(0 AS BIT) AS [IsPolyBaseInstalled]',
        "'LOCAL' AS [Name]",
        "'' AS [InstanceName]",
        '1 AS [Status]',
        "'\\' AS [PathSeparator]",
        '0 AS [IsContainedAuthentication]',
        'NULL AS [ServerType]'
      ];
      return `SELECT ${colunas.join(', ')}`;
    }

    // Batch de descoberta de propriedades do servidor feito pelo SMO durante a
    // conexao. xp_instance_regread e sys.database_files nao existem no
    // simulador, entao devolvemos as mesmas colunas com valores de uma
    // instancia local (collation case-insensitive, sem cluster e sem fulltext).
    if (/\bxp_instance_regread\b/i.test(código) && /\bdatabase_files\b/i.test(código)) {
      const caminho = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL';
      return (
        'SELECT CAST(0 AS BIT) AS [IsCaseSensitive], ' +
        '38 AS [MaxPrecision], ' +
        `'${caminho}\\Log' AS [ErrorLogPath], ` +
        `'${caminho}\\' AS [RootDirectory], ` +
        "'\\' AS [PathSeparator], " +
        'CAST(0 AS BIT) AS [IsFullTextInstalled], ' +
        `'${caminho}\\DATA' AS [MasterDBLogPath], ` +
        `'${caminho}\\DATA' AS [MasterDBPath], ` +
        "'16.00.4035.2' AS [VersionString], " +
        "'Standard Edition (64-bit)' AS [Edition], " +
        "'RTM' AS [ProductLevel], " +
        'CAST(0 AS BIT) AS [IsSingleUser], ' +
        '2 AS [EngineEdition], ' +
        "'SQL_Latin1_General_CP1_CI_AS' AS [Collation], " +
        "'LOCAL' AS [NetName], " +
        'CAST(0 AS BIT) AS [IsClustered], ' +
        "'16.00.4035.2' AS [ResourceVersionString], " +
        "'2023-01-01T00:00:00' AS [ResourceLastUpdateDateTime], " +
        '0 AS [CollationID], ' +
        '196609 AS [ComparisonStyle], ' +
        '1 AS [SqlCharSet], ' +
        "'ascii' AS [SqlCharSetName], " +
        '52 AS [SqlSortOrder], ' +
        "'nocase_iso' AS [SqlSortOrderName], " +
        "'v4.0.30319' AS [BuildClrVersionString], " +
        "'LOCAL' AS [ComputerNamePhysicalNetBIOS], " +
        'CAST(0 AS BIT) AS [IsPolyBaseInstalled]'
      );
    }

    // Batch enxuto de caminhos enviado pela aba Filegroups do New Database.
    // Nao contem xp_instance_regread, entao o batch completo acima nao o captura.
    if (
      /\bDECLARE\s+@MasterPath\b/i.test(código) &&
      /@MasterPath\s+AS\s+\[MasterDBPath\]/i.test(sql) &&
      /@LogPath\s+AS\s+\[MasterDBLogPath\]/i.test(sql)
    ) {
      const caminho = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA';
      return `SELECT '${caminho}' AS [MasterDBPath], '${caminho}' AS [MasterDBLogPath]`;
    }

    // Batch de Settings do SMO: le registry do servidor e devolve varias
    // colunas de uma vez. Sem este caso o handler generico de xp_instance_
    // regread devolve somente a ultima coluna ([PerfMonMode]) e o SMO fica com
    // DefaultFile/DefaultLog vazios ao abrir o New Database.
    if (
      /\bSmoAuditLevel\b/i.test(sql) &&
      /\bNumberOfLogFiles\b/i.test(sql) &&
      /\bSmoPerfMonMode\b/i.test(sql) &&
      /\binstancedefaultdatapath\b/i.test(sql)
    ) {
      const caminho = 'C:\\Program Files\\Microsoft SQL Server\\MSSQL16.MSSQLSERVER\\MSSQL\\DATA';
      return (
        'SELECT 2 AS [AuditLevel], 12 AS [NumberOfLogFiles], 2 AS [LoginMode], ' +
        `'${caminho}' AS [DefaultFile], '${caminho}' AS [DefaultLog], ` +
        '0 AS [ErrorLogSizeKb], -1 AS [TapeLoadWaitTime], ' +
        "'' AS [MailProfile], " +
        `'${caminho}' AS [BackupDirectory], 1000 AS [PerfMonMode]`
      );
    }

    // Propriedades caras do Server, lidas uma a uma via xp_regread/xp_instance_
    // regread ou montadas em #SVer a partir de xp_msver. O SMO emite um batch
    // por propriedade e espera exatamente uma coluna com o nome dela; devolver
    // o resultset de descoberta (14 colunas) faz o cliente ler por posicao e
    // falhar com NullReferenceException. Fica depois dos batches completos
    // acima para nao capturar suas colunas.
    const ehBatchSVer = /#SVer\b/i.test(sql) && /\bxp_msver\b/i.test(sql);
    if (/\b(?:xp_regread|xp_instance_regread)\b/i.test(sql) || ehBatchSVer) {
      const apelidos = [...sql.matchAll(/\bAS\s+\[([^\]]+)\]/gi)].map((m) => m[1]);
      const apelido = apelidos[apelidos.length - 1];
      if (apelido && /^[A-Za-z][A-Za-z0-9_]*$/.test(apelido)) {
        const valores = {
          BrowserServiceAccount: "''",
          BrowserStartMode: '4',
          ErrorLogSizeKb: '0',
          HardwareGeneration: "'Gen5'",
          HostDistribution: "'Windows'",
          HostPlatform: "'Windows'",
          HostRelease: "'10.0'",
          HostServicePackLevel: "''",
          HostSku: '0',
          Language: "'1033'",
          OSVersion: "'10.0'",
          PhysicalMemory: '8388608',
          PhysicalMemoryUsageInKB: '8388608',
          Platform: "'Windows'",
          ProcessorUsage: '0',
          Processors: '8',
          Product: "'Microsoft SQL Server'",
          ReservedStorageSizeMB: '0',
          ServiceInstanceId: "'MSSQLSERVER'",
          ServiceTier: "'Local'",
          UsedStorageSizeMB: '0',
          VersionMajor: '16',
          VersionMinor: '0'
        };
        const valor = valores[apelido];
        if (valor !== undefined || !ehBatchSVer) {
          return `SELECT ${valor || '0'} AS [${apelido}]`;
        }
      }
    }

    if (/\bxp_msver\b/i.test(código) && /#SVer\b/i.test(código)) {
      // O SSMS 19 inclui Server_Status nesse resultset; versoes antigas do SMO
      // nao incluem. O numero de colunas precisa bater exatamente com o SQL
      // original, senao o cliente falha ao ler o schema.
      const colunas = [
        "'LOCAL' AS [Server_Name]",
        "'Server[@Name=''LOCAL'']' AS [Server_Urn]",
        'NULL AS [Server_ServerType]'
      ];
      if (/\bServer_Status\b/i.test(sql)) colunas.push('1 AS [Server_Status]');
      colunas.push(
        '0 AS [Server_IsContainedAuthentication]',
        '16 AS [VersionMajor]',
        '0 AS [VersionMinor]',
        '4035 AS [BuildNumber]',
        '0 AS [IsSingleUser]',
        "'Standard Edition (64-bit)' AS [Edition]",
        '2 AS [EngineEdition]',
        '0 AS [IsXTPSupported]',
        "'16.00.4035.2' AS [VersionString]",
        "'Windows' AS [HostPlatform]",
        '0 AS [IsFullTextInstalled]'
      );
      return `SELECT ${colunas.join(', ')}`;
    }

    // Segundo batch de descoberta do SSMS: edição, versão e protocolo de conexão.
    if (
      /\bDECLARE\s+@edition\s+sysname\b/i.test(código) &&
      /\bSERVERPROPERTY\b/i.test(código) &&
      /\bCONNECTIONPROPERTY\b/i.test(sql) &&
      /\bMICROSOFTVERSION\b/i.test(código)
    ) {
      return (
        'SELECT 1 AS [DatabaseEngineType], ' +
        '2 AS [DatabaseEngineEdition], ' +
        "'16.00.4035.2' AS [ProductVersion], " +
        '16 AS [MicrosoftVersion], ' +
        "'Windows' AS [host_platform], " +
        "'TCP' AS [ConnectionProtocol]"
      );
    }

    // Verificação de AlwaysOn feita pelo SMO ao conectar. xp_qv é uma
    // stored procedure interna que não existe no simulador; -1/-0 indicam
    // "não é uma instância AlwaysOn" e evitam consultas de disponibilidade.
    if (/\bxp_qv\b/i.test(código) && /\bAlwaysOn\b/i.test(sql)) {
      return 'SELECT -1 AS [AlwaysOn]';
    }

    // Consulta de AdminConnection/SmoEnabled feita pelo SMO ao conectar.
    if (
      /\bIS_SRVROLEMEMBER\b/i.test(sql) &&
      /\bAdminConnection\b/i.test(sql) &&
      /\bSmoEnabled\b/i.test(sql)
    ) {
      // SmoEnabled=1 evita que o SSMS tente alterar sys.configurations para
      // habilitar SMO (a alteração não é suportada pelo simulador).
      return 'SELECT CAST(0 AS BIT) AS [AdminConnection], CAST(1 AS BIT) AS [SmoEnabled]';
    }

    // Verificação de contained authentication feita pelo SSMS ao abrir o master.
    if (
      /\bdb_id\s*\(\s*\)/i.test(código) &&
      /\bdm_exec_sessions\b/i.test(sql) &&
      /\bauthenticating_database_id\b/i.test(sql)
    ) {
      // db_id() = 1 é master; autenticação contida é sempre 0 no cluster simulado.
      return 'SELECT 0 AS [IsContainedAuthentication]';
    }

    // SERVERPROPERTY, CONNECTIONPROPERTY, IS_SRVROLEMEMBER, sys.databases e
    // sys.configurations agora existem de verdade no catálogo (system-catalog.js).
    return sql;
  }

  /**
   * Suporte procedural conservador: DECLARE/SET lineares e o subconjunto usado
   * por clientes como o SSMS durante a conexão (IF com condição entre
   * parênteses, BEGIN TRY/CATCH e EXEC sp_executesql com literal).
   * Loops e EXEC de procedures arbitrários continuam sendo rejeitados.
   * @private
   */
  _traduzirProcedural(sql) {
    const ehTrigger = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b/i.test(this._mascarar(sql).code);
    let resultado = sql;

    if (!ehTrigger) {
      resultado = this._desembrulharTryCatch(resultado);
      resultado = this._desembrulharIfCondicional(resultado);
      resultado = this._desembrulharExecSql(resultado);
      this._validarProceduralResidual(resultado);
    }

    const variáveis = new Map();

    resultado = this._substituirTodos(
      resultado,
      '\\bDECLARE\\s+@(\\w+)\\s+[^=;]+(?:\\s*=\\s*([^;]+))?',
      (correspondência, original) => {
        const nome = `@${correspondência[1]}`;
        const sinal = original.indexOf('=');
        if (sinal >= 0) {
          let valor = original.slice(sinal + 1).trim();
          valor = this._resolverVariaveis(valor, variáveis);
          valor = this._traduzirFuncoes(valor);
          variáveis.set(nome, valor);
        }
        return '';
      }
    );

    resultado = this._substituirTodos(
      resultado,
      '\\bSET\\s+@(\\w+)\\s*=\\s*([^;]+)',
      (correspondência, original) => {
        const nome = `@${correspondência[1]}`;
        const sinal = original.indexOf('=');
        let valor = original.slice(sinal + 1).trim();
        valor = this._resolverVariaveis(valor, variáveis);
        valor = this._traduzirFuncoes(valor);
        variáveis.set(nome, valor);
        return '';
      }
    );

    resultado = this._resolverVariaveis(resultado, variáveis);

    if (!ehTrigger) {
      resultado = this._desembrulharExecSql(resultado);
      this._validarProceduralResidual(resultado);
    }

    // Remove ponto e vírgula órfão deixado por uma declaração no início do lote.
    return resultado.replace(/^(?:\s*;+\s*)+/, '');
  }

  /** Garante que nenhum construto procedural não suportado permaneça. @private */
  _validarProceduralResidual(sql) {
    const código = this._mascarar(sql).code
      .replace(/\bEXEC(?:UTE)?\s+(?:sys\.)?sp_executesql\b/gi, ' ')
      // DROP TABLE IF EXISTS e sintaxe valida tanto no SQL Server quanto no SQLite.
      .replace(/\bDROP\s+TABLE\s+IF\s+EXISTS\b/gi, 'DROP TABLE');
    const restanteProcedural =
      /\b(?:WHILE|GOTO|RETURN|THROW|RAISERROR|EXEC|EXECUTE)\b/i.test(código) ||
      /\bIF\b(?!\s+NOT\s+EXISTS\b)/i.test(código) ||
      /\bBEGIN\b(?!\s+TRAN(?:ACTION)?\b)/i.test(código);

    if (restanteProcedural) {
      throw this._badRequest(
        'Blocos procedurais T-SQL (IF, WHILE, BEGIN...END, EXEC) não suportados pelo tradutor SQL Server para SQLite.'
      );
    }
  }

  /** Remove BEGIN TRY/END TRY e descarta o bloco CATCH. @private */
  _desembrulharTryCatch(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 20; tentativa += 1) {
      const código = this._mascarar(resultado).code;
      const inícioTry = /\bBEGIN\s+TRY\b/i.exec(código);
      if (!inícioTry) break;

      const afterTry = inícioTry.index + inícioTry[0].length;
      const fimTry = /\bEND\s+TRY\b/i.exec(código.slice(afterTry));
      if (!fimTry) break;
      const fimTryAbs = afterTry + fimTry.index;

      const inícioCatch = /\bBEGIN\s+CATCH\b/i.exec(código.slice(fimTryAbs + fimTry[0].length));
      if (!inícioCatch) break;
      const inícioCatchAbs = fimTryAbs + fimTry[0].length + inícioCatch.index;
      const afterCatch = inícioCatchAbs + inícioCatch[0].length;

      const fimCatch = /\bEND\s+CATCH\b/i.exec(código.slice(afterCatch));
      if (!fimCatch) break;
      const fimCatchAbs = afterCatch + fimCatch.index + fimCatch[0].length;

      const corpo = resultado.slice(afterTry, fimTryAbs).trim();
      resultado = resultado.slice(0, inícioTry.index) + corpo + resultado.slice(fimCatchAbs);
    }

    return resultado;
  }

  /**
   * Transforma IF (<condição>) <comando> e IF EXISTS (<consulta>) <comando>
   * no comando interno. Condições de metadados usadas por clientes são tratadas
   * como verdadeiras; IF com expressão simples permanece rejeitado.
   * @private
   */
  _desembrulharIfCondicional(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 50; tentativa += 1) {
      const código = this._mascarar(resultado).code;
      const condição = /\bIF\s+(?:EXISTS\s*)?\(/i.exec(código);
      if (!condição) break;

      const abertura = condição.index + condição[0].length - 1;
      const fechamento = this._parenCorespondente(código, abertura);
      if (fechamento < 0) break;

      let inícioCorpo = fechamento + 1;
      while (inícioCorpo < código.length && /\s/.test(código[inícioCorpo])) {
        inícioCorpo += 1;
      }

      const restante = código.slice(inícioCorpo);
      const bloco = /^BEGIN\b/i.exec(restante);
      let fimCorpo;

      if (bloco && !/^BEGIN\s+(?:TRY|CATCH|TRAN|TRANSACTION)\b/i.test(restante)) {
        const fimBloco = this._fimBlocoBeginEnd(código, inícioCorpo);
        if (fimBloco < 0) break;
        inícioCorpo += bloco[0].length;
        fimCorpo = fimBloco - 3;
      } else {
        fimCorpo = this._proximoPontoVirgula(código, inícioCorpo);
        if (fimCorpo < 0) fimCorpo = resultado.length;
      }

      const corpo = resultado.slice(inícioCorpo, fimCorpo).trim();
      resultado = resultado.slice(0, condição.index) + corpo + resultado.slice(fimCorpo);
    }

    return resultado;
  }

  /** Desembrulha EXEC/EXECUTE sp_executesql com SQL literal. @private */
  _desembrulharExecSql(sql) {
    return sql.replace(
      /\bEXEC(?:UTE)?\s+(?:sys\.)?sp_executesql\s*\(?\s*N?'((?:''|[^'])*)'\s*\)?(?:\s*,[^;]*)?/gi,
      (correspondência, texto) => texto.replace(/''/g, "'")
    );
  }

  /** Encontra o END que fecha o BEGIN em `inicio`. @private */
  _fimBlocoBeginEnd(código, inicio) {
    const regex = /\b(?:BEGIN|END)\b/gi;
    regex.lastIndex = inicio;
    let profundidade = 0;
    let correspondência;

    while ((correspondência = regex.exec(código)) !== null) {
      if (/^BEGIN$/i.test(correspondência[0])) {
        profundidade += 1;
      } else {
        profundidade -= 1;
        if (profundidade === 0) {
          return correspondência.index + correspondência[0].length;
        }
      }
    }

    return -1;
  }

  /** Encontra o próximo ponto e vírgula de nível superior. @private */
  _proximoPontoVirgula(código, inicio) {
    let profundidade = 0;

    for (let i = inicio; i < código.length; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')' && profundidade > 0) {
        profundidade -= 1;
      } else if (código[i] === ';' && profundidade === 0) {
        return i;
      }
    }

    return -1;
  }

  /** Substitui referências a variáveis já declaradas fora de literais. @private */
  _resolverVariaveis(sql, variáveis) {
    let resultado = sql;
    for (const [nome, valor] of variáveis) {
      resultado = this._substituirTodos(
        resultado,
        `${escaparRegex(nome)}\\b`,
        () => `(${valor})`
      );
    }
    return resultado;
  }

  /** Traduz funções escalares do T-SQL para equivalentes SQLite. @private */
  _traduzirFuncoes(sql, gravarDataHora = false) {
    let resultado = sql;
    const agora = gravarDataHora ? 'unixepoch()' : "datetime('now')";

    for (let passada = 0; passada < 2; passada += 1) {
      resultado = this._substituirTodos(
        resultado,
        '\\b(?:GETDATE|SYSDATETIME)\\s*\\(\\s*\\)',
        () => agora
      );
      resultado = this._substituirTodos(
        resultado,
        '\\bCURRENT_TIMESTAMP\\b(?:\\s*\\(\\s*\\))?',
        () => agora
      );
      resultado = this._substituirTodos(
        resultado,
        '\\bNEWID\\s*\\(\\s*\\)',
        () => EXPRESSAO_NEWID
      );
      resultado = this._substituirTodos(resultado, '\\bISNULL\\s*\\(', () => 'COALESCE(');
      resultado = this._substituirTodos(resultado, '\\bLEN\\s*\\(', () => 'LENGTH(');
      resultado = this._traduzirCharindex(resultado);
      // CONVERT(tipo(n), valor) → CONVERT('TIPO', valor). A função CONVERT é
      // registrada pelo catálogo de sistema; o tipo T-SQL não é expressão SQL.
      resultado = this._substituirTodos(
        resultado,
        '\\bCONVERT\\s*\\(\\s*(N?VARCHAR|N?CHAR|INT|INTEGER|BIGINT|SMALLINT|TINYINT|BIT|' +
          'DECIMAL|NUMERIC|FLOAT|REAL|DATETIME2|DATETIME|DATE|TIME|UNIQUEIDENTIFIER|' +
          'BINARY|VARBINARY|MONEY|SMALLMONEY|TEXT|XML)\\s*(?:\\([^()]*\\))?\\s*,',
        (correspondência) => `CONVERT('${correspondência[1].toUpperCase()}',`
      );
      // Tipos T-SQL cujo nome não contém CHAR/TEXT/BLOB/etc. recebem afinidade
      // NUMERIC no SQLite: CAST('LOCAL' AS sysname) devolve 0. Sem isso o URN
      // montado pelo SMO vira Server[@Name='0'] e a conexão falha.
      resultado = this._substituirTodos(
        resultado,
        '\\bAS\\s+(?:SYSNAME|UNIQUEIDENTIFIER|XML|DATETIME2|DATETIME|SMALLDATETIME|DATE|TIME)\\b',
        () => 'AS TEXT'
      );
      // CAST(nome AS varbinary(n)) precisa preservar os bytes no SQLite: com
      // afinidade numerica o nome viraria 0 e o SMO nao encontrava o filegroup.
      resultado = this._substituirTodos(
        resultado,
        '\\bAS\\s+(?:VARBINARY|BINARY)\\s*\\(\\s*(?:\\d+|MAX)\\s*\\)',
        () => 'AS BLOB'
      );
      resultado = this._traduzirDateAdd(resultado);
    }

    return resultado;
  }

  /**
   * Converte CHARINDEX(agulha, palheiro) do T-SQL em instr(palheiro, agulha) do
   * SQLite. As mascaras de string escondem as aspas no codigo, entao os
   * argumentos precisam ser lidos do SQL original usando os indices da mascara.
   * @private
   */
  _traduzirCharindex(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 30; tentativa += 1) {
      const código = this._mascarar(resultado).code;
      const chamada = /\bCHARINDEX\s*\(/i.exec(código);
      if (!chamada) break;

      const abertura = chamada.index + chamada[0].length - 1;
      const fechamento = this._parenCorespondente(código, abertura);
      if (fechamento < 0) break;

      const argumentos = resultado.slice(abertura + 1, fechamento);
      const máscara = this._mascarar(argumentos);
      let virgula = -1;
      let profundidade = 0;
      for (let i = 0; i < máscara.code.length; i += 1) {
        const caractere = máscara.code[i];
        if (caractere === '(') profundidade += 1;
        else if (caractere === ')' && profundidade > 0) profundidade -= 1;
        else if (caractere === ',' && profundidade === 0) {
          virgula = i;
          break;
        }
      }
      if (virgula < 0) break;

      const agulha = argumentos.slice(0, virgula).trim().replace(/^N(?=')/i, '');
      const palheiro = argumentos.slice(virgula + 1).trim();
      resultado =
        resultado.slice(0, chamada.index) +
        `instr(${palheiro}, ${agulha})` +
        resultado.slice(fechamento + 1);
    }

    return resultado;
  }

  /**
   * Converte concatenação de strings do T-SQL (`+`) no operador `||` do SQLite.
   * Só troca o operador quando um dos lados é literal de texto; somas numéricas
   * (bitmask de server roles, por exemplo) continuam com `+`.
   * @private
   */
  _traduzirConcatenacao(sql) {
    const máscara = this._mascarar(sql);
    const código = máscara.code;
    const posicoes = [];

    for (let i = 0; i < código.length; i += 1) {
      if (código[i] !== '+') continue;

      const anterior = máscara.tokens
        .filter((token) => token.tipo === 'texto' && token.fim <= i)
        .sort((a, b) => b.fim - a.fim)[0];
      const posterior = máscara.tokens
        .filter((token) => token.tipo === 'texto' && token.início >= i + 1)
        .sort((a, b) => a.início - b.início)[0];
      const temTextoAntes = !!anterior && código.slice(anterior.fim, i).trim() === '';
      const temTextoDepois = !!posterior && código.slice(i + 1, posterior.início).trim() === '';
      if (!temTextoAntes && !temTextoDepois) continue;

      // Quando só o lado direito é literal, ainda precisamos garantir que
      // existe operando à esquerda (para não trocar um `+` unário).
      if (!temTextoAntes) {
        let antes = i - 1;
        while (antes >= 0 && /\s/.test(código[antes])) antes -= 1;
        if (antes < 0 || /[,(=+\-*/%&|^<>]/.test(código[antes])) continue;
      }

      posicoes.push(i);
    }

    let resultado = sql;
    for (let i = posicoes.length - 1; i >= 0; i -= 1) {
      resultado = resultado.slice(0, posicoes[i]) + '||' + resultado.slice(posicoes[i] + 1);
    }
    return resultado;
  }

  /** Converte DATEADD(unit, n, base) em datetime(base, modificador). @private */
  _traduzirDateAdd(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 20; tentativa += 1) {
      const máscara = this._mascarar(resultado);
      const correspondência = /\bDATEADD\s*\(/i.exec(máscara.code);
      if (!correspondência) {
        break;
      }
      const abertura = correspondência.index + correspondência[0].length - 1;
      const fechamento = this._parenCorespondente(máscara.code, abertura);
      if (fechamento < 0) {
        break;
      }
      const argumentos = this._argumentos(máscara.code, abertura, fechamento);
      if (argumentos.length !== 3) {
        break;
      }
      const unidade = this._mascarar(máscara.code.slice(argumentos[0].início, argumentos[0].fim))
        .code.trim()
        .toLowerCase();
      const equivalente = UNIDADES_DATEADD[unidade];
      if (!equivalente) {
        break;
      }

      const quantidade = máscara.code
        .slice(argumentos[1].início, argumentos[1].fim)
        .trim();
      const quantidadeOriginal = resultado
        .slice(argumentos[1].início, argumentos[1].fim)
        .trim();
      const baseOriginal = resultado.slice(argumentos[2].início, argumentos[2].fim).trim();
      const base = this._traduzirFuncoes(baseOriginal);

      let modificador;
      if (/^[+-]?\d+$/.test(quantidade)) {
        const valor = parseInt(quantidade, 10) * equivalente.fator;
        modificador = `'${valor >= 0 ? '+' : '-'}${Math.abs(valor)} ${equivalente.modificador}'`;
      } else {
        const expressao =
          equivalente.fator === 1
            ? `(${quantidadeOriginal})`
            : `((${quantidadeOriginal}) * ${equivalente.fator})`;
        modificador = `printf('%+d', ${expressao}) || ' ${equivalente.modificador}'`;
      }

      const substituição = `datetime(${base}, ${modificador})`;
      resultado = resultado.slice(0, correspondência.index) + substituição + resultado.slice(fechamento + 1);
    }

    return resultado;
  }

  /** Converte TOP em LIMIT, posicionando-o no fim da consulta/subconsulta. @private */
  _traduzirTop(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 20; tentativa += 1) {
      const máscara = this._mascarar(resultado);
      const correspondência = /\bTOP\s+(\(\s*(\d+)\s*\)|(\d+))(?:\s+PERCENT\b)?/i.exec(
        máscara.code
      );
      if (!correspondência) {
        break;
      }
      if (!/\bSELECT\b/i.test(máscara.code.slice(0, correspondência.index))) {
        throw this._badRequest('TOP não suportado fora de uma instrução SELECT.');
      }
      if (/\bWITH\s+TIES\b/i.test(máscara.code.slice(correspondência.index))) {
        throw this._badRequest('TOP ... WITH TIES não suportado pelo tradutor SQL Server para SQLite.');
      }

      const quantidade = correspondência[2] || correspondência[3];
      resultado =
        resultado.slice(0, correspondência.index) +
        resultado.slice(correspondência.index + correspondência[0].length);

      const novaMáscara = this._mascarar(resultado);
      const ponto = this._pontoInsercaoLimite(novaMáscara.code, correspondência.index);
      let fim = ponto;
      while (fim > correspondência.index && /\s/.test(resultado[fim - 1])) {
        fim -= 1;
      }
      resultado = resultado.slice(0, fim) + ` LIMIT ${quantidade}` + resultado.slice(fim);
    }

    return resultado;
  }

  /** Localiza o fim da SELECT que contém `posição` (parêntese ou ponto e vírgula). @private */
  _pontoInsercaoLimite(código, posição) {
    let profundidade = 0;
    for (let i = 0; i < posição; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')') {
        profundidade -= 1;
      }
    }
    const profundidadeBase = profundidade;

    for (let i = posição; i < código.length; i += 1) {
      if (código[i] === '(') {
        profundidade += 1;
      } else if (código[i] === ')') {
        if (profundidadeBase > 0 && profundidade === profundidadeBase) {
          return i;
        }
        profundidade -= 1;
      } else if (código[i] === ';' && profundidade === profundidadeBase) {
        return i;
      }
    }
    return código.length;
  }

  /** Traduz tipos e IDENTITY somente em CREATE TABLE / ALTER TABLE. @private */
  _traduzirDdl(sql) {
    const segmentos = this._segmentosInstrucoes(this._mascarar(sql).code);
    let resultado = sql;

    for (let i = segmentos.length - 1; i >= 0; i -= 1) {
      const { início, fim } = segmentos[i];
      const trecho = sql.slice(início, fim);
      if (!/\b(?:CREATE|ALTER)\s+TABLE\b/i.test(this._mascarar(trecho).code)) {
        continue;
      }
      let traduzido = this._traduzirTipos(trecho);
      traduzido = this._removerOpcoesRestricao(traduzido);
      traduzido = this._removerOnPrimary(traduzido);
      traduzido = this._traduzirIdentity(traduzido);
      traduzido = this._removerChavePrimariaRedundante(traduzido);
      resultado = resultado.slice(0, início) + traduzido + resultado.slice(fim);
    }

    return resultado;
  }

  /** Aplica a tabela de tipos ao trecho DDL informado. @private */
  _traduzirTipos(sql) {
    // O SSMS escreve os tipos entre colchetes ([int], [nvarchar](50)).
    // Normaliza antes de aplicar a tabela, porque _mascarar() esconde os
    // identificadores entre colchetes e impediria o casamento dos tipos.
    let resultado = sql.replace(
      /\[(NVARCHAR|VARCHAR|NCHAR|CHAR|UNIQUEIDENTIFIER|SYSNAME|XML|TEXT|SMALLDATETIME|DATETIME2|DATETIME|DATE|TIME|SMALLMONEY|MONEY|DECIMAL|NUMERIC|DOUBLE(?:\s+PRECISION)?|FLOAT|REAL|VARBINARY|BINARY|IMAGE|BIGINT|SMALLINT|TINYINT|INTEGER|INT|BIT)\](?=\s*(?:$|[(),]|\b))/gi,
      (_correspondencia, tipo) => tipo
    );
    const marcadores = new Map();
    for (const [regex, tipo] of TIPOS_DDL) {
      // Tipos sem argumentos não devem casar com funções já traduzidas,
      // como datetime('now'), gerada a partir de GETDATE().
      const fonte = regex.source.includes('\\(')
        ? regex.source
        : `${regex.source}(?!\\s*\\()`;
      // O SQLite nao preserva o tipo T-SQL original; guardamos o tipo em
      // hexadecimal dentro de um comentario para o catalogo reconstruir
      // user_type_id/max_length/precision/scale ao gerar scripts no SSMS.
      // Usamos marcadores porque o tipo traduzido tambem aparece no comentario
      // e o _substituirTodos() repetiria a substituicao ate o limite de 500.
      resultado = this._substituirTodos(resultado, fonte, (_correspondencia, original) => {
        const chave = `__TSQL_TIPO_${marcadores.size}__`;
        marcadores.set(
          chave,
          `${tipo} /*TSQL:${Buffer.from(String(original).trim()).toString('hex').toUpperCase()}*/`
        );
        return chave;
      });
    }
    for (const [chave, valor] of marcadores) {
      resultado = resultado.split(chave).join(valor);
    }
    return resultado;
  }

  /**
   * Remove as opções de storage do SQL Server (CLUSTERED/NONCLUSTERED e
   * WITH (...)) das restrições de chave primária/única em nível de tabela.
   * O SQLite não aceita essas cláusulas em CREATE TABLE.
   * @private
   */
  _removerOpcoesRestricao(sql) {
    return sql.replace(
      /(\b(?:CONSTRAINT\s+(?:\[[^\]]+\]|"[^"]+"|\w+)\s+)?(?:PRIMARY\s+KEY|UNIQUE))\s+(?:CLUSTERED|NONCLUSTERED)?\s*(\([^)]*\))(?:\s*WITH\s*\([^)]*\))?/gi,
      (_correspondencia, inicio, colunas) => `${inicio} ${colunas}`
    );
  }

  /** Remove as cláusulas ON/TEXTIMAGE_ON [PRIMARY] de um trecho DDL. @private */
  _removerOnPrimary(sql) {
    return this._substituirTodos(
      sql,
      '\\s+(?:TEXTIMAGE_ON|ON)\\s+(?:\\[PRIMARY\\]|"PRIMARY"|PRIMARY)(?!\\w)',
      () => '',
      true
    );
  }

  /**
   * Remove a PRIMARY KEY em nivel de tabela quando a coluna IDENTITY ja virou
   * INTEGER PRIMARY KEY AUTOINCREMENT. O SSMS gera as duas declaracoes.
   * @private
   */
  _removerChavePrimariaRedundante(sql) {
    if (!/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/i.test(this._mascarar(sql).code)) {
      return sql;
    }
    return this._substituirTodos(
      sql,
      ',\\s*CONSTRAINT\\s+(?:\\[[^\\]]+\\]|"[^"]+"|\\w+)\\s+PRIMARY\\s+KEY\\s+' +
        '(?:CLUSTERED|NONCLUSTERED)?\\s*\\([^)]*\\)(?:\\s*WITH\\s*\\([^)]*\\))?',
      () => '',
      true
    );
  }

  /** Converte IDENTITY(seed,increment) em AUTOINCREMENT sem perder os valores. @private */
  _traduzirIdentity(sql) {
    let resultado = sql;
    const padraoIdentity = /\bIDENTITY\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/i;

    for (let tentativa = 0; tentativa < 20; tentativa += 1) {
      const máscara = this._mascarar(resultado);
      const correspondência = padraoIdentity.exec(máscara.code);
      if (!correspondência) {
        break;
      }
      // O SQLite nao guarda seed/increment; o catalogo le este marcador para
      // devolver IDENTITY(seed,increment) ao gerar o script no SSMS.
      // Usa '_' em vez de ',' porque o separador de definicoes do catalogo
      // quebra a coluna em cada virgula, inclusive dentro de comentarios.
      const marcador = ` /*TSQLID:${correspondência[1]}_${correspondência[2]}*/`;
      const limites = this._limitesColuna(máscara.code, correspondência.index);
      const códigoColuna = máscara.code.slice(limites.início, limites.fim);
      const temChave = /\bPRIMARY\s+KEY\b/i.test(códigoColuna);
      const temInteger = /\bINTEGER\b/i.test(códigoColuna);

      if (temChave) {
        const chave = /\bPRIMARY\s+KEY\b/i.exec(códigoColuna);
        const ponto = limites.início + chave.index + chave[0].length;
        resultado = resultado.slice(0, ponto) + ' AUTOINCREMENT' + resultado.slice(ponto);
        const novaMáscara = this._mascarar(resultado);
        const novamente = padraoIdentity.exec(novaMáscara.code);
        if (!novamente) {
          break;
        }
        const novosLimites = this._limitesColuna(novaMáscara.code, novamente.index);
        resultado =
          resultado.slice(0, novamente.index) +
          resultado.slice(novamente.index + novamente[0].length);
        const fimColuna = novosLimites.fim - novamente[0].length;
        resultado = resultado.slice(0, fimColuna) + marcador + resultado.slice(fimColuna);
        continue;
      }

      const substituição = `${temInteger ? 'PRIMARY KEY AUTOINCREMENT' : 'INTEGER PRIMARY KEY AUTOINCREMENT'}${marcador}`;
      resultado =
        resultado.slice(0, correspondência.index) +
        substituição +
        resultado.slice(correspondência.index + correspondência[0].length);
    }

    return resultado;
  }

  /** Delimita a definição de coluna que contém `posição`. @private */
  _limitesColuna(código, posição) {
    let profundidade = 0;
    let início = 0;
    let aberturaTabela = -1;

    for (let i = 0; i < posição; i += 1) {
      const caractere = código[i];
      if (caractere === '(') {
        if (profundidade === 0) {
          aberturaTabela = i;
        }
        profundidade += 1;
      } else if (caractere === ')') {
        profundidade -= 1;
      } else if (caractere === ',' && profundidade === 1) {
        início = i + 1;
      }
    }
    if (aberturaTabela >= 0 && início < aberturaTabela) {
      início = aberturaTabela + 1;
    }

    let fim = código.length;
    for (let i = posição; i < código.length; i += 1) {
      const caractere = código[i];
      if (caractere === '(') {
        profundidade += 1;
      } else if (caractere === ')') {
        profundidade -= 1;
        if (profundidade === 0) {
          fim = i;
          break;
        }
      } else if (caractere === ',' && profundidade === 1) {
        fim = i;
        break;
      }
    }

    return { início, fim };
  }

  /** Converte MERGE simples em INSERT ... ON CONFLICT DO UPDATE. @private */
  _traduzirMerge(sql) {
    let resultado = sql;

    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      const máscara = this._mascarar(resultado);
      if (!/^\s*MERGE\b/i.test(máscara.code)) {
        break;
      }
      try {
        resultado = this._traduzirMergeUnico(resultado, máscara);
      } catch (erro) {
        if (erro.code === 'BadRequestException') {
          throw erro;
        }
        throw this._badRequest(`MERGE não suportado: ${erro.message}`);
      }
    }

    return resultado;
  }

  /** Traduz um único comando MERGE. @private */
  _traduzirMergeUnico(sql, máscara) {
    const código = máscara.code;
    const semTexto = máscara.noStrings;
    let posição = código.search(/\S/);
    const falhar = (detalhe) => {
      throw this._badRequest(`MERGE não suportado: ${detalhe}`);
    };

    const lerPalavras = (fonte) => {
      const encontrado = fonte.exec(código.slice(posição));
      if (!encontrado) {
        return null;
      }
      posição += encontrado[0].length;
      return encontrado;
    };

    if (!lerPalavras(/^MERGE(?:\s+INTO)?\s+/i)) {
      falhar('falta a cláusula MERGE INTO.');
    }

    const lerIdentificador = () => {
      const encontrado = /^(?:\[[^\]]+\]|\w+)(?:\s*\.\s*(?:\[[^\]]+\]|\w+))*/i.exec(
        semTexto.slice(posição)
      );
      if (!encontrado) {
        falhar('não foi possível identificar a tabela.');
      }
      const valor = sql.slice(posição, posição + encontrado[0].length);
      posição += encontrado[0].length;
      return valor;
    };

    const lerAlias = (palavraSeguinte) => {
      const encontrado = /^\s+(?:AS\s+)?([A-Za-z_]\w*)\b/i.exec(código.slice(posição));
      if (encontrado && encontrado[1].toUpperCase() !== palavraSeguinte) {
        posição += encontrado[0].length;
        return encontrado[1];
      }
      return null;
    };

    const destino = lerIdentificador();
    const aliasDestino = lerAlias('USING');
    if (!lerPalavras(/^\s+USING\s+/i)) {
      falhar('falta a cláusula USING.');
    }
    const origem = lerIdentificador();
    const aliasOrigem = lerAlias('ON');
    if (!lerPalavras(/^\s+ON\s+/i)) {
      falhar('falta a cláusula ON.');
    }

    const inícioOn = posição;
    const próximoWhen = /\s+WHEN\s+/i.exec(código.slice(posição));
    if (!próximoWhen) {
      falhar('falta a cláusula WHEN MATCHED.');
    }
    const fimOn = posição + próximoWhen.index;
    posição = fimOn + próximoWhen[0].length;
    const condiçãoOn = código.slice(inícioOn, fimOn);

    const colunasConflito = [];
    const partesOn = this._dividirPorE(condiçãoOn);
    for (const parte of partesOn) {
      const comparacao = /^\s*(?:(\w+)\.)?(\w+)\s*=\s*(?:(\w+)\.)?(\w+)\s*$/i.exec(parte);
      if (!comparacao) {
        falhar('a condição ON deve conter apenas igualdades simples.');
      }
      const esq = comparacao[1];
      const dir = comparacao[3];
      const alvos = [aliasDestino, aliasOrigem, this._ultimoSegmento(destino), this._ultimoSegmento(origem)]
        .filter(Boolean)
        .map((nome) => nome.toLowerCase());
      const ehDestino = (nome) => !!nome && alvos.includes(nome.toLowerCase());
      const ehOrigem = (nome) =>
        !!nome &&
        [aliasOrigem, this._ultimoSegmento(origem)].filter(Boolean).some(
          (candidate) => candidate.toLowerCase() === nome.toLowerCase()
        );

      if (ehDestino(esq) && ehOrigem(dir) && !ehOrigem(esq)) {
        colunasConflito.push(comparacao[2]);
      } else if (ehOrigem(esq) && ehDestino(dir) && !ehOrigem(dir)) {
        colunasConflito.push(comparacao[4]);
      } else {
        falhar('a condição ON deve ligar uma coluna de origem a uma coluna de destino.');
      }
    }
    if (colunasConflito.length === 0) {
      falhar('não foi possível determinar as colunas de conflito.');
    }

    const atualizacao = lerPalavras(/^MATCHED\s+THEN\s+UPDATE\s+SET\s+/i);
    if (!atualizacao) {
      falhar('é necessário WHEN MATCHED THEN UPDATE SET.');
    }
    const inícioSet = posição;
    const próximoWhenSet = /\s+WHEN\s+/i.exec(código.slice(posição));
    const pontoVirgula = código.indexOf(';', posição);
    const fimSet = próximoWhenSet
      ? posição + próximoWhenSet.index
      : pontoVirgula >= 0
        ? pontoVirgula
        : código.length;
    const atribuicoes = this._dividirLista(sql.slice(inícioSet, fimSet)).map((atribuição) => {
      const encontrado = /^(?:(?:\w+)\.)?(\w+)\s*=\s*([\s\S]+)$/i.exec(atribuição);
      if (!encontrado) {
        falhar('atribuição inválida em UPDATE SET.');
      }
      let expressao = encontrado[2].trim();
      expressao = this._trocarQualificador(
        expressao,
        aliasOrigem || this._ultimoSegmento(origem),
        'excluded'
      );
      expressao = this._trocarQualificador(expressao, aliasDestino, '');
      return `${encontrado[1]} = ${expressao}`;
    });
    if (atribuicoes.length === 0) {
      falhar('UPDATE SET está vazio.');
    }

    if (!próximoWhenSet) {
      falhar('falta WHEN NOT MATCHED THEN INSERT.');
    }
    posição = fimSet;
    if (!lerPalavras(/^\s*WHEN\s+/i)) {
      falhar('cláusula WHEN inválida após UPDATE SET.');
    }
    if (!lerPalavras(/^NOT\s+MATCHED(?:\s+BY\s+TARGET)?\s+THEN\s+INSERT\s*\(/i)) {
      falhar('somente WHEN NOT MATCHED THEN INSERT é suportado.');
    }
    const fechoColunas = this._parenCorespondente(código, posição - 1);
    if (fechoColunas < 0) {
      falhar('lista de colunas do INSERT está incompleta.');
    }
    const colunas = sql.slice(posição, fechoColunas).trim();
    posição = fechoColunas + 1;
    if (!lerPalavras(/^\s*VALUES\s*\(/i)) {
      falhar('falta a lista VALUES do INSERT.');
    }
    const fechoValores = this._parenCorespondente(código, posição - 1);
    if (fechoValores < 0) {
      falhar('lista VALUES está incompleta.');
    }
    const valores = sql.slice(posição, fechoValores).trim();
    posição = fechoValores + 1;
    if (código.slice(posição).replace(/[\s;]/g, '') !== '') {
      falhar('cláusulas adicionais após WHEN NOT MATCHED.');
    }

    const origemSql = aliasOrigem ? `${origem} AS ${aliasOrigem}` : origem;
    return (
      `INSERT INTO ${destino} (${colunas}) SELECT ${valores} FROM ${origemSql} WHERE 1=1 ` +
      `ON CONFLICT (${colunasConflito.join(', ')}) DO UPDATE SET ${atribuicoes.join(', ')}`
    );
  }

  /** Divide uma condição por AND usando a máscara para ignorar literais. @private */
  _dividirPorE(condição) {
    const máscara = this._mascarar(condição);
    const partes = [];
    const regex = /\s+AND\s+/gi;
    let encontrado;
    let início = 0;
    while ((encontrado = regex.exec(máscara.code)) !== null) {
      partes.push(condição.slice(início, encontrado.index));
      início = encontrado.index + encontrado[0].length;
    }
    partes.push(condição.slice(início));
    return partes.filter((parte) => parte.trim().length > 0);
  }

  /** Último segmento de um nome qualificado, sem colchetes. @private */
  _ultimoSegmento(nome) {
    return String(nome).replace(/[[\]]/g, '').split('.').pop().trim();
  }

  /** Substitui `alias.` por `substituto.` fora de literais e colchetes. @private */
  _trocarQualificador(sql, alias, substituto) {
    if (!alias) {
      return sql;
    }
    const prefijo = `(?<![\\w@])${escaparRegex(alias)}\\s*\\.\\s*`;
    const novo = substituto ? `${substituto}.` : '';
    return this._substituirTodos(sql, prefijo, () => novo);
  }

  /** Converte UPDATE ... JOIN simples em UPDATE ... WHERE EXISTS. @private */
  _traduzirUpdateJoin(sql) {
    const máscara = this._mascarar(sql);
    if (!/^\s*UPDATE\b/i.test(máscara.code)) {
      return sql;
    }
    const junções = (máscara.code.match(/\bJOIN\b/gi) || []).length;
    if (junções === 0) {
      return sql;
    }
    const falhar = (detalhe) => {
      throw this._badRequest(`UPDATE ... JOIN não suportado: ${detalhe}`);
    };
    if (
      junções !== 1 ||
      /\b(?:LEFT|RIGHT|FULL|CROSS|OUTER|APPLY)\b/i.test(máscara.code)
    ) {
      falhar('somente um JOIN interno simples é suportado.');
    }

    try {
      return this._traduzirUpdateJoinUnico(sql, máscara, falhar);
    } catch (erro) {
      if (erro.code === 'BadRequestException') {
        throw erro;
      }
      falhar(erro.message);
    }
  }

  /** Traduz um único UPDATE com JOIN. @private */
  _traduzirUpdateJoinUnico(sql, máscara, falhar) {
    const código = máscara.code;
    const início = /^\s*UPDATE\s+/i.exec(código)[0].length;
    const pontoVirgula = código.indexOf(';', início);
    const fim = pontoVirgula >= 0 ? pontoVirgula : código.length;
    const comPontoVirgula = /;\s*$/.test(sql.trim());

    const índiceDe = (regex, de) => {
      const encontrado = regex.exec(código.slice(de, fim));
      return encontrado ? de + encontrado.index : -1;
    };
    const índiceJoin = índiceDe(/\bJOIN\b/i, início);
    const índiceSet = índiceDe(/\bSET\b/i, início);
    const índiceWhere = índiceDe(/\bWHERE\b/i, início);
    if (índiceJoin < 0 || índiceSet < 0) {
      falhar('não foi possível localizar JOIN e SET.');
    }

    let alvo;
    let atribuições;
    let inícioOrigem;
    let fimCondição;
    let inícioAtribuições;
    let fimAtribuições;

    if (índiceSet < índiceJoin) {
      // Forma T-SQL: UPDATE alvo SET ... FROM ... JOIN origem ON ...
      alvo = sql.slice(início, índiceSet).trim().replace(/\s+INNER$/i, '');
      const índiceFrom = índiceDe(/\bFROM\b/i, índiceSet);
      if (índiceFrom < 0) {
        falhar('falta a cláusula FROM após SET.');
      }
      const marcaJoin = /\bJOIN\s+/i.exec(código.slice(índiceFrom, fim));
      if (!marcaJoin) {
        falhar('falta a cláusula JOIN após FROM.');
      }
      inícioAtribuições = índiceSet + /\bSET\s+/i.exec(código.slice(índiceSet, fim))[0].length;
      fimAtribuições = índiceFrom;
      atribuições = sql.slice(inícioAtribuições, fimAtribuições).trim();
      inícioOrigem = índiceFrom + marcaJoin.index + marcaJoin[0].length;
      fimCondição = índiceWhere >= 0 && índiceWhere > índiceJoin ? índiceWhere : fim;
    } else {
      // Forma: UPDATE alvo JOIN origem ON ... SET ... WHERE ...
      alvo = sql.slice(início, índiceJoin).trim().replace(/\s+INNER$/i, '');
      inícioOrigem = índiceJoin + /\bJOIN\s+/i.exec(código.slice(índiceJoin, fim))[0].length;
      fimCondição = índiceSet;
      inícioAtribuições = índiceSet + /\bSET\s+/i.exec(código.slice(índiceSet, fim))[0].length;
      fimAtribuições = índiceWhere >= 0 && índiceWhere > inícioAtribuições ? índiceWhere : fim;
      atribuições = sql.slice(inícioAtribuições, fimAtribuições).trim();
    }

    const marcaOn = /\bON\s+/i.exec(código.slice(inícioOrigem, fimCondição));
    if (!marcaOn) {
      falhar('falta a cláusula ON do JOIN.');
    }
    const origem = sql.slice(inícioOrigem, inícioOrigem + marcaOn.index).trim();
    const inícioCondição = inícioOrigem + marcaOn.index + marcaOn[0].length;
    let condição = sql.slice(inícioCondição, fimCondição).trim();

    let condiçãoWhere = '';
    if (índiceWhere >= 0 && índiceWhere > inícioAtribuições) {
      const marcaWhere = /\bWHERE\s+/i.exec(código.slice(índiceWhere, fim));
      condiçãoWhere = sql
        .slice(índiceWhere + marcaWhere[0].length, fim)
        .trim();
    }

    const palavrasAlvo = alvo.split(/\s+/);
    let aliasAlvo = null;
    let alvoSql = alvo;
    if (
      palavrasAlvo.length > 1 &&
      /^[A-Za-z_]\w*$/.test(palavrasAlvo[palavrasAlvo.length - 1])
    ) {
      aliasAlvo = palavrasAlvo[palavrasAlvo.length - 1];
      const comAs =
        palavrasAlvo[palavrasAlvo.length - 2].toUpperCase() === 'AS';
      alvoSql = palavrasAlvo.slice(0, palavrasAlvo.length - (comAs ? 2 : 1)).join(' ');
    }
    atribuições = this._trocarQualificador(atribuições, aliasAlvo, '');
    condição = this._trocarQualificador(condição, aliasAlvo, alvoSql);
    condiçãoWhere = this._trocarQualificador(condiçãoWhere, aliasAlvo, alvoSql);

    const filtro = condiçãoWhere ? ` AND (${condiçãoWhere})` : '';
    const resultado =
      `UPDATE ${alvoSql} SET ${atribuições} WHERE EXISTS ` +
      `(SELECT 1 FROM ${origem} WHERE ${condição}${filtro})`;
    return comPontoVirgula ? `${resultado};` : resultado;
  }
}

module.exports = SqlTranslator;
module.exports.SqlTranslator = SqlTranslator;
