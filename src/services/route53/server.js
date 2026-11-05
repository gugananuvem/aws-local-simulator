/**
 * Route53 Server
 * REST API para gerenciamento de DNS
 * AWS CLI compatible com respostas em XML
 */

const express = require('express');
const logger = require('../../utils/logger');

class Route53Server {
  constructor(port, config) {
    this.port = port;
    this.config = config;
    this.app = express();
    this.setupMiddlewares();
  }

  setupMiddlewares() {
    // ===== CORS Middleware =====
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.header('Access-Control-Max-Age', '86400');
      
      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    // Capture ALL request bodies as raw text regardless of Content-Type
    this.app.use(express.raw({ type: () => true, limit: '10mb' }));

    // Copy body to rawBody for compatibility, then log
    this.app.use((req, res, next) => {
      // Normalise rawBody: handle both Buffer and string
      let data = '';
      if (Buffer.isBuffer(req.body)) {
        data = req.body.toString('utf8');
      } else if (typeof req.body === 'string') {
        data = req.body;
      }
      req.rawBody = data;

      console.log(`\n[Route53 RAW] ${req.method} ${req.path} ${Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : ''}`);
      console.log(`[Route53 RAW] Headers:`);
      console.log(`  Content-Type: ${req.get('content-type')}`);
      console.log(`  Content-Length: ${req.get('content-length')}`);
      console.log(`  User-Agent: ${req.get('user-agent')}`);
      console.log(`  Authorization: ${req.get('authorization') ? req.get('authorization').substring(0, 30) + '...' : 'undefined'}`);
      console.log(`[Route53 RAW] Body length: ${data.length}`);
      console.log(`[Route53 RAW] Body (first 800 chars): ${data.substring(0, 800)}`);
      console.log(`[Route53 RAW] Body (last 200 chars): ${data.substring(Math.max(0, data.length - 200))}`);

      const contentType = req.get('content-type') || '';
      if (data && contentType.includes('application/json')) {
        try {
          req.body = JSON.parse(data);
          console.log(`[Route53 RAW] Parsed as JSON`);
        } catch (e) {
          console.error(`[Route53 RAW] JSON Parse Error: ${e.message}`);
          req.body = data;
        }
      } else {
        console.log(`[Route53 RAW] Using raw text body (not JSON)`);
        req.body = data;
      }
      next();
    });

    this.app.use((req, res, next) => {
      if (req.path.includes('/2013-04-01/hostedzone')) {
        logger.info(`[Route53] ${req.method} ${req.path}`);
      }
      
      // Por padrão retorna XML (para AWS CLI)
      if (req.get('accept')?.includes('application/json') || req.path.includes('/json/')) {
        res.set('Content-Type', 'application/json');
      } else {
        res.set('Content-Type', 'application/xml');
      }
      next();
    });
  }

  // Helper para gerar resposta XML
  xmlResponse(xml) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
  }

  // Helper para gerar resposta de erro no formato correto do AWS Route53
  errorResponse(statusCode, errorType, message) {
    const xml = `<ErrorResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <Error>
    <Type>${errorType}</Type>
    <Code>${errorType}</Code>
    <Message>${message}</Message>
  </Error>
  <RequestId>req-${Date.now()}</RequestId>
</ErrorResponse>`;
    return { statusCode, xml };
  }

  // Parser de XML simplificado
  parseXML(xmlString) {
    const result = {};
    
    // Extrair Name
    const nameMatch = xmlString.match(/<Name>([^<]+)<\/Name>/);
    if (nameMatch) result.Name = nameMatch[1].trim();
    
    // Extrair CallerReference
    const refMatch = xmlString.match(/<CallerReference>([^<]+)<\/CallerReference>/);
    if (refMatch) result.CallerReference = refMatch[1].trim();
    
    // Extrair Type
    const typeMatch = xmlString.match(/<Type>([^<]+)<\/Type>/);
    if (typeMatch) result.Type = typeMatch[1].trim();
    
    // Extrair TTL
    const ttlMatch = xmlString.match(/<TTL>(\d+)<\/TTL>/);
    if (ttlMatch) result.TTL = parseInt(ttlMatch[1]);
    
    // Extrair Values/ResourceRecords
    const valueMatches = xmlString.match(/<Value>([^<]+)<\/Value>/g);
    if (valueMatches) {
      result.ResourceRecords = valueMatches.map(v => {
        const val = v.replace(/<\/?Value>/g, '').trim();
        return { Value: val };
      });
    }
    
    return result;
  }

  parseChangeBatchXML(xmlString) {
    const changes = [];
    
    // Find all Change blocks
    const changeMatches = xmlString.match(/<Change>[\s\S]*?<\/Change>/g) || [];
    
    for (const changeXml of changeMatches) {
      const change = {};
      
      // Extract Action
      const actionMatch = changeXml.match(/<Action>([^<]+)<\/Action>/);
      if (actionMatch) change.Action = actionMatch[1].trim();
      
      // Extract ResourceRecordSet
      const resourceRecordSetMatch = changeXml.match(/<ResourceRecordSet>([\s\S]*?)<\/ResourceRecordSet>/);
      if (resourceRecordSetMatch) {
        const rrsXml = resourceRecordSetMatch[1];
        const rrs = {};
        
        // Extract Name
        const nameMatch = rrsXml.match(/<Name>([^<]+)<\/Name>/);
        if (nameMatch) rrs.Name = nameMatch[1].trim();
        
        // Extract Type
        const typeMatch = rrsXml.match(/<Type>([^<]+)<\/Type>/);
        if (typeMatch) rrs.Type = typeMatch[1].trim();
        
        // Extract TTL
        const ttlMatch = rrsXml.match(/<TTL>(\d+)<\/TTL>/);
        if (ttlMatch) rrs.TTL = parseInt(ttlMatch[1]);
        
        // Extract ResourceRecords
        const valueMatches = rrsXml.match(/<Value>([^<]+)<\/Value>/g) || [];
        rrs.ResourceRecords = valueMatches.map(v => {
          const val = v.replace(/<\/?Value>/g, '').trim();
          return { Value: val };
        });
        
        change.ResourceRecordSet = rrs;
      }
      
      if (change.Action && change.ResourceRecordSet) {
        changes.push(change);
      }
    }
    
    return { Changes: changes };
  }

  async initialize(simulator) {
    this.simulator = simulator;
    this.setupRoutes();
  }

  setupRoutes() {
    // === ROTAS JSON (para dashboard React) ===
    this.app.get('/json/hosted-zones', (req, res) => this.listHostedZonesJson(req, res));
    this.app.get('/json/hosted-zone/:id/records', (req, res) => this.listResourceRecordsJson(req, res));
    this.app.post('/json/hosted-zone', (req, res) => this.createHostedZoneJson(req, res));
    this.app.delete('/json/hosted-zone/:id', (req, res) => this.deleteHostedZoneJson(req, res));
    
    // === ROTAS XML (para AWS CLI) ===
    // Hosted Zones
    this.app.post('/2013-04-01/hostedzone', (req, res) => this.createHostedZone(req, res));
    this.app.get('/2013-04-01/hostedzone', (req, res) => this.listHostedZones(req, res));
    this.app.get('/2013-04-01/hostedzone/:id', (req, res) => this.getHostedZone(req, res));
    this.app.delete('/2013-04-01/hostedzone/:id', (req, res) => this.deleteHostedZone(req, res));

    // Resource Records
    // Use both POST methods - one for batch changes, one for single record
    this.app.post('/2013-04-01/hostedzone/:id/rrset', (req, res) => {
      // AWS CLI sends XML for change-resource-record-sets; always route to changeResourceRecordSets
      // which handles both XML (ChangeResourceRecordSetsRequest with Changes array)
      // and JSON batch payloads.
      const body = req.body || '';
      if (typeof body === 'string' && body.trim().startsWith('<')) {
        // XML body — always a ChangeBatch operation
        this.changeResourceRecordSets(req, res);
      } else if (typeof body === 'object' && body !== null && Array.isArray(body.Changes)) {
        this.changeResourceRecordSets(req, res);
      } else if (typeof body === 'string') {
        // Try JSON
        try {
          const parsed = JSON.parse(body);
          if (parsed.Changes && Array.isArray(parsed.Changes)) {
            req.body = parsed;
            this.changeResourceRecordSets(req, res);
          } else {
            this.createResourceRecord(req, res);
          }
        } catch (e) {
          // Not JSON either — fall through to single-record create
          this.createResourceRecord(req, res);
        }
      } else {
        this.createResourceRecord(req, res);
      }
    });
    this.app.get('/2013-04-01/hostedzone/:id/rrset', (req, res) => this.listResourceRecords(req, res));
    this.app.delete('/2013-04-01/hostedzone/:id/rrset/:name/:type', (req, res) => this.deleteResourceRecord(req, res));

    // Health Checks
    this.app.post('/2013-04-01/healthcheck', (req, res) => this.createHealthCheck(req, res));
    this.app.get('/2013-04-01/healthcheck', (req, res) => this.listHealthChecks(req, res));
    this.app.get('/2013-04-01/healthcheck/:id', (req, res) => this.getHealthCheck(req, res));
    this.app.delete('/2013-04-01/healthcheck/:id', (req, res) => this.deleteHealthCheck(req, res));

    // DNS Resolution
    this.app.get('/2013-04-01/resolve/:domain/:type', (req, res) => this.resolveDNS(req, res));
  }

  async createHostedZone(req, res) {
    try {
      logger.info('[Route53] Raw body:', req.rawBody ? req.rawBody.substring(0, 300) : 'empty');
      
      let body = {};
      
      // Parsear body (XML ou JSON)
      if (typeof req.body === 'string' && req.body.trim().startsWith('<')) {
        // É XML
        body = this.parseXML(req.body);
      } else if (typeof req.body === 'string') {
        // Tentar JSON
        try {
          body = JSON.parse(req.body);
        } catch (e) {
          logger.error('[Route53] Erro ao parsear body');
        }
      } else if (typeof req.body === 'object') {
        body = req.body;
      }

      logger.info('[Route53] Parsed body:', body);

      const { Name, CallerReference } = body;

      if (!Name) {
        const { statusCode, xml } = this.errorResponse(400, 'MissingParameter', 'Name is required');
        return res.status(statusCode).send(this.xmlResponse(xml));
      }

      const zone = this.simulator.createHostedZone(Name, {
        CallerReference: CallerReference || Date.now().toString(),
      });

      const zoneData = zone.toJSON();
      const xml = `<CreateHostedZoneResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <HostedZone>
    <Id>${zoneData.Id}</Id>
    <Name>${zoneData.Name}</Name>
    <CallerReference>${zoneData.CallerReference}</CallerReference>
    <Config>
      <PrivateZone>false</PrivateZone>
    </Config>
    <ResourceRecordSetCount>0</ResourceRecordSetCount>
  </HostedZone>
  <ChangeInfo>
    <Id>/change/${zoneData.Id.replace(/^\/hostedzone\//, "")}</Id>
    <Status>PENDING</Status>
    <SubmittedAt>${new Date().toISOString()}</SubmittedAt>
  </ChangeInfo>
  <DelegationSet>
    <NameServers>
      <NameServer>ns-1.example.com</NameServer>
      <NameServer>ns-2.example.com</NameServer>
      <NameServer>ns-3.example.com</NameServer>
      <NameServer>ns-4.example.com</NameServer>
    </NameServers>
  </DelegationSet>
</CreateHostedZoneResponse>`;

      res.status(201).send(this.xmlResponse(xml));
    } catch (error) {
      logger.error('[Route53] CreateHostedZone error:', error);
      const { statusCode, xml } = this.errorResponse(400, 'InternalError', error.message);
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async listHostedZones(req, res) {
    try {
      const zones = this.simulator.listHostedZones();
      
      const zonesXml = zones.map(z => {
        const zone = z.toJSON();
        return `
    <HostedZone>
      <Id>${zone.Id}</Id>
      <Name>${zone.Name}</Name>
      <CallerReference>${zone.CallerReference}</CallerReference>
      <Config>
        <PrivateZone>false</PrivateZone>
      </Config>
      <ResourceRecordSetCount>${zone.ResourceRecordSetCount || 0}</ResourceRecordSetCount>
    </HostedZone>`;
      }).join('');

      const xml = `<ListHostedZonesResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <HostedZones>${zonesXml}
  </HostedZones>
  <IsTruncated>false</IsTruncated>
  <MaxItems>100</MaxItems>
</ListHostedZonesResponse>`;

      res.send(this.xmlResponse(xml));
    } catch (error) {
      const { statusCode, xml } = this.errorResponse(400, 'InternalError', error.message);
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async getHostedZone(req, res) {
    try {
      const zone = this.simulator.getHostedZone(req.params.id);
      if (!zone) {
        const { statusCode, xml } = this.errorResponse(404, 'NoSuchHostedZone', `Hosted Zone not found with ID: ${req.params.id}`);
        return res.status(statusCode).send(this.xmlResponse(xml));
      }

      const zoneData = zone.toJSON();
      const xml = `<GetHostedZoneResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <HostedZone>
    <Id>${zoneData.Id}</Id>
    <Name>${zoneData.Name}</Name>
    <CallerReference>${zoneData.CallerReference}</CallerReference>
    <Config>
      <PrivateZone>false</PrivateZone>
    </Config>
    <ResourceRecordSetCount>${zoneData.ResourceRecordSetCount || 0}</ResourceRecordSetCount>
  </HostedZone>
  <DelegationSet>
    <NameServers>
      <NameServer>ns-1.example.com</NameServer>
      <NameServer>ns-2.example.com</NameServer>
      <NameServer>ns-3.example.com</NameServer>
      <NameServer>ns-4.example.com</NameServer>
    </NameServers>
  </DelegationSet>
</GetHostedZoneResponse>`;

      res.send(this.xmlResponse(xml));
    } catch (error) {
      const { statusCode, xml } = this.errorResponse(400, 'InternalError', error.message);
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async deleteHostedZone(req, res) {
    try {
      this.simulator.deleteHostedZone(req.params.id);
      
      const xml = `<DeleteHostedZoneResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeInfo>
    <Id>/change/${req.params.id}</Id>
    <Status>PENDING</Status>
    <SubmittedAt>${new Date().toISOString()}</SubmittedAt>
  </ChangeInfo>
</DeleteHostedZoneResponse>`;

      res.send(this.xmlResponse(xml));
    } catch (error) {
      const errorType = error.message && error.message.includes('not found') ? 'NoSuchHostedZone' : 'InternalError';
      const { statusCode, xml } = this.errorResponse(
        errorType === 'NoSuchHostedZone' ? 404 : 400,
        errorType,
        error.message
      );
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async createResourceRecord(req, res) {
    try {
      let body = {};
      
      if (typeof req.body === 'string' && req.body.trim().startsWith('<')) {
        body = this.parseXML(req.body);
      } else if (typeof req.body === 'string') {
        try {
          body = JSON.parse(req.body);
        } catch (e) {}
      } else {
        body = req.body || {};
      }

      const { id } = req.params;
      const { Name, Type, TTL, ResourceRecords } = body;

      if (!Name || !Type || !ResourceRecords || ResourceRecords.length === 0) {
        const { statusCode, xml } = this.errorResponse(400, 'MissingParameter', 'Name, Type, and ResourceRecords are required');
        return res.status(statusCode).send(this.xmlResponse(xml));
      }

      const values = ResourceRecords.map(r => typeof r === 'string' ? r : r.Value);
      const record = this.simulator.createResourceRecord(id, Name, Type, values, { TTL: TTL || 300 });

      const xml = `<ChangeResourceRecordSetsResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeInfo>
    <Id>/change/${id}</Id>
    <Status>PENDING</Status>
    <SubmittedAt>${new Date().toISOString()}</SubmittedAt>
  </ChangeInfo>
</ChangeResourceRecordSetsResponse>`;

      res.status(201).send(this.xmlResponse(xml));
    } catch (error) {
      const { statusCode, xml } = this.errorResponse(400, 'InternalError', error.message);
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async changeResourceRecordSets(req, res) {
    try {
      const { id } = req.params;

      // Validate zone exists before processing changes
      const zone = this.simulator.getHostedZone(id);
      if (!zone) {
        const { statusCode, xml } = this.errorResponse(404, 'NoSuchHostedZone', `No hosted zone found with ID: ${id}`);
        return res.status(statusCode).send(this.xmlResponse(xml));
      }

      let changeBatch = {};

      console.log(`\n[changeResourceRecordSets] Processing request for zone: ${id}`);
      console.log(`[changeResourceRecordSets] req.body type: ${typeof req.body}`);
      console.log(`[changeResourceRecordSets] req.body: ${JSON.stringify(req.body).substring(0, 300)}`);

      // Parse XML or JSON
      if (typeof req.body === 'string' && req.body.trim().startsWith('<')) {
        console.log('[changeResourceRecordSets] Parsing as XML');
        changeBatch = this.parseChangeBatchXML(req.body);
      } else if (typeof req.body === 'string') {
        console.log('[changeResourceRecordSets] Parsing as JSON string');
        try {
          changeBatch = JSON.parse(req.body);
        } catch (e) {
          console.error(`[changeResourceRecordSets] JSON Parse Error: ${e.message}`);
          console.error(`[changeResourceRecordSets] Body: ${req.body.substring(0, 500)}`);
          const { statusCode, xml } = this.errorResponse(400, 'InvalidInput', `Invalid request body: ${e.message}`);
          return res.status(statusCode).send(this.xmlResponse(xml));
        }
      } else if (typeof req.body === 'object') {
        console.log('[changeResourceRecordSets] Using object body');
        changeBatch = req.body || {};
      }

      console.log(`[changeResourceRecordSets] Parsed changeBatch: ${JSON.stringify(changeBatch).substring(0, 300)}`);

      const { Changes } = changeBatch;
      if (!Changes || !Array.isArray(Changes)) {
        console.error(`[changeResourceRecordSets] No Changes array found`);
        const { statusCode, xml } = this.errorResponse(400, 'InvalidInput', 'ChangeBatch with Changes array is required');
        return res.status(statusCode).send(this.xmlResponse(xml));
      }

      console.log(`[changeResourceRecordSets] Found ${Changes.length} changes to process`);

      // Process each change
      for (let i = 0; i < Changes.length; i++) {
        const change = Changes[i];
        console.log(`[changeResourceRecordSets] Processing change ${i}: ${JSON.stringify(change).substring(0, 200)}`);
        
        const { Action, ResourceRecordSet } = change;
        const { Name, Type, TTL, ResourceRecords } = ResourceRecordSet || {};

        console.log(`[changeResourceRecordSets] Action: ${Action}, Name: ${Name}, Type: ${Type}`);

        if (!Action || !ResourceRecordSet || !Name || !Type || !ResourceRecords) {
          console.error(`[changeResourceRecordSets] Invalid change - Missing required fields`);
          const { statusCode, xml } = this.errorResponse(400, 'InvalidInput', 'Each Change must have Action, Name, Type, and ResourceRecords');
          return res.status(statusCode).send(this.xmlResponse(xml));
        }

        if (Action === 'CREATE') {
          console.log(`[changeResourceRecordSets] Creating record: ${Name}`);
          const values = ResourceRecords.map(r => typeof r === 'string' ? r : r.Value);
          this.simulator.createResourceRecord(id, Name, Type, values, { TTL: TTL || 300 });
          console.log(`[changeResourceRecordSets] Record created successfully`);
        } else if (Action === 'DELETE') {
          console.log(`[changeResourceRecordSets] Deleting record: ${Name}`);
          this.simulator.deleteResourceRecord(id, Name, Type);
        } else if (Action === 'UPSERT') {
          console.log(`[changeResourceRecordSets] Upserting record: ${Name}`);
          try {
            this.simulator.deleteResourceRecord(id, Name, Type);
          } catch (e) {
            // Record might not exist, that's ok
          }
          const values = ResourceRecords.map(r => typeof r === 'string' ? r : r.Value);
          this.simulator.createResourceRecord(id, Name, Type, values, { TTL: TTL || 300 });
        }
      }

      const xml = `<ChangeResourceRecordSetsResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeInfo>
    <Id>/change/${id}</Id>
    <Status>PENDING</Status>
    <SubmittedAt>${new Date().toISOString()}</SubmittedAt>
  </ChangeInfo>
</ChangeResourceRecordSetsResponse>`;

      console.log(`[changeResourceRecordSets] ✅ Success - sending response`);
      res.status(200).send(this.xmlResponse(xml));
    } catch (error) {
      console.error(`[changeResourceRecordSets] ❌ Error:`, error);
      const { statusCode, xml } = this.errorResponse(400, 'InternalError', error.message);
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async listResourceRecords(req, res) {
    try {
      const { id } = req.params;

      // Validate zone exists before processing
      const zone = this.simulator.getHostedZone(id);
      if (!zone) {
        const { statusCode, xml } = this.errorResponse(404, 'NoSuchHostedZone', `No hosted zone found with ID: ${id}`);
        return res.status(statusCode).send(this.xmlResponse(xml));
      }

      const records = this.simulator.listResourceRecords(id);

      const recordsXml = records.map(r => {
        const record = r.toJSON();
        const resourceRecords = record.ResourceRecords.map(rr => 
          `<ResourceRecord><Value>${rr.Value}</Value></ResourceRecord>`
        ).join('');
        
        return `
    <ResourceRecordSet>
      <Name>${record.Name}</Name>
      <Type>${record.Type}</Type>
      <TTL>${record.TTL}</TTL>
      <ResourceRecords>${resourceRecords}</ResourceRecords>
    </ResourceRecordSet>`;
      }).join('');

      const xml = `<ListResourceRecordSetsResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ResourceRecordSets>${recordsXml}
  </ResourceRecordSets>
  <IsTruncated>false</IsTruncated>
  <MaxItems>100</MaxItems>
</ListResourceRecordSetsResponse>`;

      res.send(this.xmlResponse(xml));
    } catch (error) {
      const { statusCode, xml } = this.errorResponse(400, 'InternalError', error.message);
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async deleteResourceRecord(req, res) {
    try {
      const { id, name, type } = req.params;
      this.simulator.deleteResourceRecord(id, decodeURIComponent(name), type);

      const xml = `<ChangeResourceRecordSetsResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <ChangeInfo>
    <Id>/change/${id}</Id>
    <Status>PENDING</Status>
    <SubmittedAt>${new Date().toISOString()}</SubmittedAt>
  </ChangeInfo>
</ChangeResourceRecordSetsResponse>`;

      res.send(this.xmlResponse(xml));
    } catch (error) {
      const errorType = error.message && error.message.includes('not found') ? 'NoSuchResourceRecordSet' : 'InternalError';
      const { statusCode, xml } = this.errorResponse(
        errorType === 'NoSuchResourceRecordSet' ? 404 : 400,
        errorType,
        error.message
      );
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async createHealthCheck(req, res) {
    try {
      let body = {};
      
      if (typeof req.body === 'string' && req.body.trim().startsWith('<')) {
        body = this.parseXML(req.body);
      } else if (typeof req.body === 'string') {
        try {
          body = JSON.parse(req.body);
        } catch (e) {}
      } else {
        body = req.body || {};
      }

      const { HealthCheckConfig } = body;

      if (!HealthCheckConfig) {
        const { statusCode, xml } = this.errorResponse(400, 'MissingParameter', 'HealthCheckConfig is required');
        return res.status(statusCode).send(this.xmlResponse(xml));
      }

      const healthCheck = this.simulator.createHealthCheck(HealthCheckConfig);
      const hcData = healthCheck.toJSON();

      const xml = `<CreateHealthCheckResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <HealthCheck>
    <Id>${hcData.Id}</Id>
    <HealthCheckConfig>
      <Type>${hcData.Type}</Type>
    </HealthCheckConfig>
  </HealthCheck>
  <HealthCheckVersion>1</HealthCheckVersion>
</CreateHealthCheckResponse>`;

      res.status(201).send(this.xmlResponse(xml));
    } catch (error) {
      const { statusCode, xml } = this.errorResponse(400, 'InternalError', error.message);
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async listHealthChecks(req, res) {
    try {
      const healthChecks = this.simulator.listHealthChecks();

      const hcsXml = healthChecks.map(hc => {
        const hcData = hc.toJSON();
        return `
    <HealthCheck>
      <Id>${hcData.Id}</Id>
      <HealthCheckConfig>
        <Type>${hcData.Type}</Type>
      </HealthCheckConfig>
    </HealthCheck>`;
      }).join('');

      const xml = `<ListHealthChecksResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <HealthChecks>${hcsXml}
  </HealthChecks>
  <IsTruncated>false</IsTruncated>
  <MaxItems>100</MaxItems>
</ListHealthChecksResponse>`;

      res.send(this.xmlResponse(xml));
    } catch (error) {
      const { statusCode, xml } = this.errorResponse(400, 'InternalError', error.message);
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async getHealthCheck(req, res) {
    try {
      const healthCheck = this.simulator.getHealthCheck(req.params.id);

      if (!healthCheck) {
        const { statusCode, xml } = this.errorResponse(404, 'NoSuchHealthCheck', `Health Check not found with ID: ${req.params.id}`);
        return res.status(statusCode).send(this.xmlResponse(xml));
      }

      const hcData = healthCheck.toJSON();
      const xml = `<GetHealthCheckResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <HealthCheck>
    <Id>${hcData.Id}</Id>
    <HealthCheckConfig>
      <Type>${hcData.Type}</Type>
    </HealthCheckConfig>
  </HealthCheck>
  <HealthCheckVersion>1</HealthCheckVersion>
</GetHealthCheckResponse>`;

      res.send(this.xmlResponse(xml));
    } catch (error) {
      const { statusCode, xml } = this.errorResponse(400, 'InternalError', error.message);
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async deleteHealthCheck(req, res) {
    try {
      this.simulator.deleteHealthCheck(req.params.id);

      const xml = `<DeleteHealthCheckResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <Success>true</Success>
</DeleteHealthCheckResponse>`;

      res.send(this.xmlResponse(xml));
    } catch (error) {
      const { statusCode, xml } = this.errorResponse(400, 'InternalError', error.message);
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async resolveDNS(req, res) {
    try {
      const { domain, type } = req.params;
      const queryType = req.query.queryType || 'simple';

      const result = this.simulator.resolveDNS(domain, type, queryType);

      const recordsXml = result.records.map(r => 
        `<Record>
      <Name>${r.Name}</Name>
      <Type>${r.Type}</Type>
      <TTL>${r.TTL}</TTL>
      <Values>${r.ResourceRecords.map(rr => `<Value>${rr.Value}</Value>`).join('')}</Values>
    </Record>`
      ).join('');

      const xml = `<ResolveDNSResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/">
  <Domain>${result.domain}</Domain>
  <Type>${result.type}</Type>
  <Records>${recordsXml}</Records>
  <ResolvedAt>${result.resolvedAt}</ResolvedAt>
</ResolveDNSResponse>`;

      res.send(this.xmlResponse(xml));
    } catch (error) {
      const { statusCode, xml } = this.errorResponse(400, 'InternalError', error.message);
      res.status(statusCode).send(this.xmlResponse(xml));
    }
  }

  async start() {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        logger.info(`✅ Route53 Server running on port ${this.port}`);
        resolve();
      });
    });
  }

  // ========== JSON ENDPOINTS (para Dashboard React) ==========
  
  async listHostedZonesJson(req, res) {
    try {
      const zones = this.simulator.listHostedZones();
      const data = zones.map(z => z.toJSON());
      res.json({ HostedZones: data, IsTruncated: false, MaxItems: '100' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async listResourceRecordsJson(req, res) {
    try {
      const { id } = req.params;
      const records = this.simulator.listResourceRecords(id);
      const data = records.map(r => r.toJSON());
      res.json({ ResourceRecordSets: data, IsTruncated: false, MaxItems: '100' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async createHostedZoneJson(req, res) {
    try {
      const { name, callerReference, isPrivate } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }

      const zone = this.simulator.createHostedZone(name, {
        CallerReference: callerReference || Date.now().toString(),
      });

      res.status(201).json({
        HostedZone: zone.toJSON(),
        ChangeInfo: {
          Id: `/change/${zone.Id}`,
          Status: 'PENDING',
          SubmittedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async deleteHostedZoneJson(req, res) {
    try {
      this.simulator.deleteHostedZone(req.params.id);
      res.json({ 
        ChangeInfo: {
          Id: `/change/${req.params.id}`,
          Status: 'PENDING',
          SubmittedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }
}

module.exports = Route53Server;
