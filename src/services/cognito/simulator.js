/**
 * Cognito Simulator Core
 * Simula User Pools, Identity Pools, Autenticação, Tokens JWT
 */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const logger = require("../../utils/logger");
const LocalStore = require("../../utils/local-store");
const path = require("path");
const { CloudTrailAudit } = require("../../utils/cloudtrail-audit");

class CognitoSimulator {
  constructor(config) {
    this.config = config;
    this.dataDir = path.join(process.env.AWS_LOCAL_SIMULATOR_DATA_DIR, "cognito");
    this.store = new LocalStore(this.dataDir);
    this.userPools = new Map();
    this.identityPools = new Map();
    this.users = new Map();
    this.sessions = new Map();
    this.refreshTokens = new Map();
    this.accessTokens = new Map();
    this.jwtSecret = crypto.randomBytes(64).toString("hex");
    this.audit = new CloudTrailAudit("cognito-idp.amazonaws.com");
    this.lambdaSimulator = null;
    this.customAuthSessions = new Map();
  }

  setLambdaSimulator(lambdaSimulator) {
    this.lambdaSimulator = lambdaSimulator;
  }

  _warnUnregisteredTriggers(pool) {
    const triggers = pool.LambdaTriggers || {};
    for (const [triggerName, fnName] of Object.entries(triggers)) {
      if (fnName && !this.lambdaSimulator?.getLambda(fnName)) {
        logger.warn(`⚠️ Cognito pool "${pool.Name}": trigger "${triggerName}" references Lambda "${fnName}" which is not registered`);
      }
    }
  }

  _buildTriggerEvent(triggerSource, userPool, user, clientId, requestFields) {
    return {
      version: "1",
      triggerSource,
      region: "us-east-1",
      userPoolId: userPool.Id,
      userName: user.Username,
      callerContext: {
        awsSdkVersion: "aws-sdk-unknown-unknown",
        clientId,
      },
      request: { ...requestFields },
      response: {},
    };
  }

  // Returns userAttributes in the flat key/value format that real Cognito sends to triggers
  _triggerUserAttributes(user) {
    return {
      sub: user.UserId,
      "cognito:user_status": user.UserStatus,
      ...user.Attributes,
    };
  }

  async _invokeTrigger(userPool, triggerName, event) {
    const fnName = userPool.LambdaTriggers?.[triggerName];
    if (!fnName) {
      return null;
    }

    if (!this.lambdaSimulator || !this.lambdaSimulator.getLambda(fnName)) {
      logger.warn(`⚠️ Cognito trigger "${triggerName}": Lambda "${fnName}" is not available, skipping`);
      return null;
    }

    const result = await this.lambdaSimulator.invoke(fnName, event, "RequestResponse");
    return result.Payload;
  }

  async initialize() {
    logger.debug("Inicializando Cognito Simulator...");
    this.loadUserPools();
    this.loadIdentityPools();
    this.loadUsers();
    this.loadSessions();
    this._watchUsersFile();

    logger.debug(`✅ Cognito Simulator inicializado com ${this.userPools.size} user pools, ${this.identityPools.size} identity pools, ${this.users.size} usuários`);
  }

  _watchUsersFile() {
    const fs = require("fs");
    const usersFilePath = this.store.getFilePath("__users__");
    if (!fs.existsSync(usersFilePath)) return;

    let reloadTimeout = null;
    fs.watch(usersFilePath, (eventType) => {
      if (eventType !== "change") return;
      // Debounce para evitar múltiplos reloads em edições rápidas
      clearTimeout(reloadTimeout);
      reloadTimeout = setTimeout(() => {
        try {
          this.users.clear();
          this.loadUsers();
          logger.info(`🔄 Cognito users recarregados do disco (${this.users.size} usuários)`);
        } catch (err) {
          logger.warn(`⚠️ Erro ao recarregar users: ${err.message}`);
        }
      }, 200);
    });

    logger.debug(`👁️ Watching: ${usersFilePath}`);
  }

  // ============ User Pool Operations ============

  createUserPool(params) {
    const { PoolName, Policies, LambdaConfig, AutoVerifiedAttributes, AliasAttributes, UsernameAttributes, MfaConfiguration, UserPoolId } = params;

    const poolId = UserPoolId ? UserPoolId : `local_${PoolName}_${Date.now()}`;
    const userPool = {
      Id: poolId,
      Name: PoolName,
      Arn: `arn:aws:cognito:local:000000000000:userpool/${poolId}`,
      Status: "ACTIVE",
      CreationDate: new Date().toISOString(),
      LastModifiedDate: new Date().toISOString(),
      Policies: Policies || {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: false,
        },
      },
      LambdaConfig: LambdaConfig || {},
      AutoVerifiedAttributes: AutoVerifiedAttributes || ["email"],
      AliasAttributes: AliasAttributes || [],
      UsernameAttributes: UsernameAttributes || ["email"],
      MfaConfiguration: MfaConfiguration || "OFF",
      EstimatedNumberOfUsers: 0,
      Users: [],
      Clients: new Map(),
      Groups: new Map(),
      IdentityProviders: new Map(),
      ResourceServers: new Map(),
    };

    this.userPools.set(poolId, userPool);
    this.persistUserPools();

    logger.debug(`✅ User Pool criado: ${PoolName} (${poolId})`);
    this.audit.record({ eventName: "CreateUserPool", readOnly: false, resources: [{ ARN: userPool.Arn, type: "AWS::Cognito::UserPool" }], requestParameters: { poolName: PoolName } });

    return {
      UserPool: {
        Id: userPool.Id,
        Name: userPool.Name,
        Arn: userPool.Arn,
        Status: userPool.Status,
        CreationDate: userPool.CreationDate,
        LastModifiedDate: userPool.LastModifiedDate,
        MfaConfiguration: userPool.MfaConfiguration,
        EstimatedNumberOfUsers: 0,
      },
    };
  }

  listUserPools(params = {}) {
    const { MaxResults = 60, NextToken } = params;
    let userPools = Array.from(this.userPools.values());

    if (NextToken) {
      const startIndex = parseInt(NextToken);
      userPools = userPools.slice(startIndex);
    }

    const results = userPools.slice(0, MaxResults);
    const nextToken = results.length === MaxResults ? String(MaxResults) : null;

    return {
      UserPools: results.map((pool) => ({
        Id: pool.Id,
        Name: pool.Name,
        Arn: pool.Arn,
        Status: pool.Status,
        CreationDate: pool.CreationDate,
        LastModifiedDate: pool.LastModifiedDate,
      })),
      NextToken: nextToken,
    };
  }

  describeUserPool(params) {
    const { UserPoolId } = params;
    const userPool = this.userPools.get(UserPoolId);

    if (!userPool) {
      throw new Error(`User pool ${UserPoolId} not found`);
    }

    return {
      UserPool: {
        Id: userPool.Id,
        Name: userPool.Name,
        Arn: userPool.Arn,
        Status: userPool.Status,
        CreationDate: userPool.CreationDate,
        LastModifiedDate: userPool.LastModifiedDate,
        Policies: userPool.Policies,
        LambdaConfig: userPool.LambdaConfig,
        AutoVerifiedAttributes: userPool.AutoVerifiedAttributes,
        AliasAttributes: userPool.AliasAttributes,
        UsernameAttributes: userPool.UsernameAttributes,
        MfaConfiguration: userPool.MfaConfiguration,
        EstimatedNumberOfUsers: userPool.Users.length,
      },
    };
  }

  listUsers(params = {}) {
    const { UserPoolId, Filter, Limit = 60, PaginationToken } = params;
    const userPool = this.userPools.get(UserPoolId);

    if (!userPool) {
      throw new Error(`User pool ${UserPoolId} not found`);
    }

    let users = Array.from(this.users.values()).filter((u) => u.UserPoolId === UserPoolId);

    if (PaginationToken) {
      const startIndex = parseInt(PaginationToken);
      users = users.slice(startIndex);
    }

    const results = users.slice(0, Limit);
    const nextToken = results.length === Limit && users.length > Limit ? String(Limit) : null;

    return {
      Users: results.map((u) => ({
        Username: u.Username,
        UserStatus: u.UserStatus,
        Enabled: u.Enabled,
        UserCreateDate: u.CreatedDate,
        UserLastModifiedDate: u.LastModifiedDate,
        Attributes: this._formatUserAttributesWithSub(u),
      })),
      PaginationToken: nextToken,
    };
  }

  listUserPoolClients(params = {}) {
    const { UserPoolId, MaxResults = 60, NextToken } = params;
    const userPool = this.userPools.get(UserPoolId);
    if (!userPool) throw new Error(`User pool ${UserPoolId} not found`);

    let clients = Array.from(userPool.Clients.values());
    if (NextToken) clients = clients.slice(parseInt(NextToken));
    const results = clients.slice(0, MaxResults);

    return {
      UserPoolClients: results.map((c) => ({
        ClientId: c.ClientId,
        ClientName: c.ClientName,
        UserPoolId: c.UserPoolId,
      })),
      NextToken: results.length === MaxResults && clients.length > MaxResults ? String(MaxResults) : null,
    };
  }

  describeUserPoolClient(params = {}) {
    const { UserPoolId, ClientId } = params;
    const userPool = this.userPools.get(UserPoolId);
    if (!userPool) throw new Error(`User pool ${UserPoolId} not found`);
    const client = userPool.Clients.get(ClientId);
    if (!client) throw new Error(`Client ${ClientId} not found`);
    return { UserPoolClient: client };
  }

  deleteUserPoolClient(params = {}) {
    const { UserPoolId, ClientId } = params;
    const userPool = this.userPools.get(UserPoolId);
    if (!userPool) throw new Error(`User pool ${UserPoolId} not found`);
    userPool.Clients.delete(ClientId);
    this.persistUserPools();
    return {};
  }

  forgotPassword(params = {}) {
    const { ClientId, Username } = params;
    const userPool = this.findUserPoolByClientId(ClientId);
    if (!userPool) throw new Error(`Client ${ClientId} not found`);

    const user = this.findUserByUsername(Username, ClientId);
    if (!user) throw new Error(`User not found: ${Username}`);

    if (user.UserStatus !== "CONFIRMED") {
      const err = new Error("Cannot reset password for the user as there is no registered/verified email or phone_number");
      err.code = "InvalidParameterException";
      throw err;
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    user.PasswordResetCode = resetCode;
    this.persistUsers();

    const userEmail = user.Attributes.email || Username;
    logger.info(`📧 [COGNITO] Código de redefinição de senha para "${Username}": ${resetCode}`);

    return {
      CodeDeliveryDetails: {
        Destination: userEmail,
        DeliveryMedium: "EMAIL",
        AttributeName: "email",
      },
    };
  }

  confirmForgotPassword(params = {}) {
    const { ClientId, Username, ConfirmationCode, Password } = params;
    const userPool = this.findUserPoolByClientId(ClientId);
    if (!userPool) throw new Error(`Client ${ClientId} not found`);

    const user = this.findUserByUsername(Username, ClientId);
    if (!user) throw new Error(`User not found: ${Username}`);

    if (user.UserStatus !== "CONFIRMED") {
      const err = new Error("Cannot reset password for the user as there is no registered/verified email or phone_number");
      err.code = "InvalidParameterException";
      throw err;
    }

    if (user.PasswordResetCode && user.PasswordResetCode !== ConfirmationCode) {
      const err = new Error("Invalid verification code provided, please try again.");
      err.code = "CodeMismatchException";
      throw err;
    }

    user.Password = this.hashPassword(Password);
    delete user.PasswordResetCode;
    this.persistUsers();
    return {};
  }

  changePassword(params = {}) {
    const { AccessToken, PreviousPassword, ProposedPassword } = params;
    const session = this.accessTokens.get(AccessToken);
    if (!session) throw new Error("Invalid access token");
    const user = this.users.get(session.UserId);
    if (!user) throw new Error("User not found");
    if (!this.verifyPassword(PreviousPassword, user.Password)) throw new Error("Incorrect previous password");
    user.Password = this.hashPassword(ProposedPassword);
    this.persistUsers();
    return {};
  }

  async respondToAuthChallenge(params = {}) {
    const { ChallengeName } = params;

    // NEW_PASSWORD_REQUIRED — user was created by admin and must set a permanent password
    if (ChallengeName === "NEW_PASSWORD_REQUIRED") {
      const session = this.customAuthSessions.get(params.Session);
      if (!session || session.challenge !== "NEW_PASSWORD_REQUIRED") {
        throw new Error("Invalid session token");
      }

      const newPassword = params.ChallengeResponses?.NEW_PASSWORD;
      if (!newPassword) throw new Error("NEW_PASSWORD is required");

      const user = this.users.get(session.userId);
      const userPool = this.userPools.get(session.userPoolId);
      if (!user || !userPool) throw new Error("Invalid session");

      // 1. PreAuthentication — dispara antes de processar a nova senha
      const preAuthEvent = this._buildTriggerEvent("PreAuthentication_Authentication", userPool, user, session.clientId, {
        userAttributes: this._triggerUserAttributes(user),
        validationData: {},
      });
      await this._invokeTrigger(userPool, "PreAuthentication", preAuthEvent);

      // 2. Aplica nova senha e confirma usuário
      user.Password = this.hashPassword(newPassword);
      user.UserStatus = "CONFIRMED";
      user.LastModifiedDate = new Date().toISOString();
      this.persistUsers();
      this.customAuthSessions.delete(params.Session);

      logger.debug(`🔑 Senha alterada e usuário confirmado: ${user.Username}`);

      // 3. PostConfirmation — dispara após confirmação do usuário (troca de senha forçada)
      const postConfirmEvent = this._buildTriggerEvent("PostConfirmation_ConfirmSignUp", userPool, user, session.clientId, {
        userAttributes: this._triggerUserAttributes(user),
      });
      try {
        await this._invokeTrigger(userPool, "PostConfirmation", postConfirmEvent);
      } catch (err) {
        logger.error(`PostConfirmation trigger error (ignored): ${err.message}`);
      }

      // 4. PreTokenGeneration — antes de gerar tokens
      const preTokenEvent = this._buildTriggerEvent("TokenGeneration_Authentication", userPool, user, session.clientId, {
        userAttributes: this._triggerUserAttributes(user),
        groupConfiguration: { groupsToOverride: [], iamRolesToOverride: [], preferredRole: null },
      });
      const preTokenResponse = await this._invokeTrigger(userPool, "PreTokenGeneration", preTokenEvent);
      const claimsOverride = preTokenResponse?.response?.claimsOverrideDetails || null;

      // 5. Gera tokens
      const accessToken = this.generateAccessToken(user, userPool, session.clientId);
      const idToken = this.generateIdToken(user, userPool, session.clientId, claimsOverride);
      const refreshToken = this.generateRefreshToken(user, userPool, session.clientId);

      const sessionId = uuidv4();
      const authSession = {
        Id: sessionId,
        UserId: user.UserId,
        UserPoolId: userPool.Id,
        ClientId: session.clientId,
        AccessToken: accessToken,
        IdToken: idToken,
        RefreshToken: refreshToken,
        CreatedAt: new Date().toISOString(),
        ExpiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
      this.sessions.set(sessionId, authSession);
      this.accessTokens.set(accessToken, authSession);
      this.refreshTokens.set(refreshToken, authSession);
      this.persistSessions();

      // 6. PostAuthentication — após auth bem-sucedida (non-blocking)
      const postAuthEvent = this._buildTriggerEvent("PostAuthentication_Authentication", userPool, user, session.clientId, {
        userAttributes: this._triggerUserAttributes(user),
        newDeviceUsed: false,
      });
      try {
        await this._invokeTrigger(userPool, "PostAuthentication", postAuthEvent);
      } catch (err) {
        logger.error(`PostAuthentication trigger error (ignored): ${err.message}`);
      }

      return {
        AuthenticationResult: {
          AccessToken: accessToken,
          IdToken: idToken,
          RefreshToken: refreshToken,
          TokenType: "Bearer",
          ExpiresIn: 3600,
        },
        ChallengeName: null,
      };
    }

    if (ChallengeName === "CUSTOM_CHALLENGE") {
      const session = this.customAuthSessions.get(params.Session);
      if (!session) {
        throw new Error("Invalid session token");
      }

      const user = this.users.get(session.userId);
      const userPool = this.userPools.get(session.userPoolId);

      // Invoke VerifyAuthChallengeResponse
      const verifyEvent = this._buildTriggerEvent("VerifyAuthChallengeResponse_Authentication", userPool, user, session.clientId, {
        challengeAnswer: params.ChallengeResponses?.ANSWER,
        privateChallengeParameters: session.privateChallengeParameters,
      });
      const verifyResponse = await this._invokeTrigger(userPool, "VerifyAuthChallengeResponse", verifyEvent);

      // Append challenge result to session
      session.session.push({
        challengeName: "CUSTOM_CHALLENGE",
        challengeResult: verifyResponse?.response?.answerCorrect === true,
        challengeMetadata: "",
      });

      // Invoke DefineAuthChallenge again with updated session
      const defineEvent = this._buildTriggerEvent("DefineAuthChallenge_Authentication", userPool, user, session.clientId, {
        session: session.session,
      });
      const defineResponse = await this._invokeTrigger(userPool, "DefineAuthChallenge", defineEvent);

      if (defineResponse?.response?.issueTokens === true) {
        // 1. PreTokenGeneration antes de gerar tokens
        const preTokenEvent = this._buildTriggerEvent("TokenGeneration_Authentication", userPool, user, session.clientId, {
          userAttributes: this._triggerUserAttributes(user),
          groupConfiguration: { groupsToOverride: [], iamRolesToOverride: [], preferredRole: null },
        });
        const preTokenResponse = await this._invokeTrigger(userPool, "PreTokenGeneration", preTokenEvent);
        const claimsOverride = preTokenResponse?.response?.claimsOverrideDetails || null;

        // 2. Gera tokens
        const accessToken = this.generateAccessToken(user, userPool, session.clientId);
        const idToken = this.generateIdToken(user, userPool, session.clientId, claimsOverride);
        const refreshToken = this.generateRefreshToken(user, userPool, session.clientId);

        const sessionId = uuidv4();
        const authSession = {
          Id: sessionId,
          UserId: user.UserId,
          UserPoolId: userPool.Id,
          ClientId: session.clientId,
          AccessToken: accessToken,
          IdToken: idToken,
          RefreshToken: refreshToken,
          CreatedAt: new Date().toISOString(),
          ExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        };

        this.sessions.set(sessionId, authSession);
        this.accessTokens.set(accessToken, authSession);
        this.refreshTokens.set(refreshToken, authSession);
        this.persistSessions();

        this.customAuthSessions.delete(params.Session);

        // 3. PostAuthentication (non-blocking)
        const postAuthEvent = this._buildTriggerEvent("PostAuthentication_Authentication", userPool, user, session.clientId, {
          userAttributes: this._triggerUserAttributes(user),
          newDeviceUsed: false,
        });
        try {
          await this._invokeTrigger(userPool, "PostAuthentication", postAuthEvent);
        } catch (err) {
          logger.error(`PostAuthentication trigger error (ignored): ${err.message}`);
        }

        return {
          AuthenticationResult: {
            AccessToken: accessToken,
            IdToken: idToken,
            RefreshToken: refreshToken,
            TokenType: "Bearer",
            ExpiresIn: 3600,
          },
          ChallengeName: null,
        };
      }

      // Issue next challenge
      const createEvent = this._buildTriggerEvent("CreateAuthChallenge_Authentication", userPool, user, session.clientId, {
        challengeName: "CUSTOM_CHALLENGE",
        session: session.session,
      });
      const createResponse = await this._invokeTrigger(userPool, "CreateAuthChallenge", createEvent);

      // Update stored private challenge parameters for next round
      session.privateChallengeParameters = createResponse?.response?.privateChallengeParameters || {};

      return {
        ChallengeName: "CUSTOM_CHALLENGE",
        ChallengeParameters: createResponse?.response?.publicChallengeParameters || {},
        Session: params.Session,
        AuthenticationResult: null,
      };
    }

    return { AuthenticationResult: null, ChallengeName: null };
  }

  revokeToken(params = {}) {
    const { Token, ClientId } = params;
    // Remove refresh token session if it exists
    const session = this.refreshTokens.get(Token);
    if (session) {
      this.sessions.delete(session.Id);
      this.accessTokens.delete(session.AccessToken);
      this.refreshTokens.delete(Token);
      this.persistSessions();
    }
    return {};
  }

  globalSignOut(params = {}) {
    const { AccessToken } = params;
    const session = this.accessTokens.get(AccessToken);
    if (session) {
      this.sessions.delete(session.Id);
      this.accessTokens.delete(AccessToken);
      this.refreshTokens.delete(session.RefreshToken);
      this.persistSessions();
    }
    return {};
  }

  getUser(params = {}) {
    const { AccessToken } = params;
    const session = this.accessTokens.get(AccessToken);
    if (!session) throw new Error("Invalid access token");
    // Check session is still active
    if (!this.sessions.has(session.Id)) throw new Error("Token has been revoked");
    const user = this.users.get(session.UserId);
    if (!user) throw new Error("User not found");
    const attributes = this._formatUserAttributesWithSub(user);
    return {
      Username: user.Username,
      UserAttributes: attributes,
      UserStatus: user.UserStatus,
    };
  }

  updateUserAttributes(params = {}) {
    const { AccessToken, UserAttributes } = params;
    const session = this.accessTokens.get(AccessToken);
    if (!session) throw new Error("Invalid access token");
    const user = this.users.get(session.UserId);
    if (!user) throw new Error("User not found");
    const updates = this.normalizeUserAttributes(UserAttributes || []);
    Object.assign(user.Attributes, updates);
    this.persistUsers();
    return { CodeDeliveryDetailsList: [] };
  }

  deleteUser(params = {}) {
    const { AccessToken } = params;
    const session = this.accessTokens.get(AccessToken);
    if (!session) throw new Error("Invalid access token");
    this.users.delete(session.UserId);
    this.persistUsers();
    return {};
  }

  adminDisableUser(params = {}) {
    const { UserPoolId, Username } = params;
    const user = this.findUserByUsername(Username, null, UserPoolId);
    if (!user) throw new Error(`User not found: ${Username}`);
    user.Enabled = false;
    this.persistUsers();
    return {};
  }

  adminEnableUser(params = {}) {
    const { UserPoolId, Username } = params;
    const user = this.findUserByUsername(Username, null, UserPoolId);
    if (!user) throw new Error(`User not found: ${Username}`);
    user.Enabled = true;
    this.persistUsers();
    return {};
  }

  adminResetUserPassword(params = {}) {
    const { UserPoolId, Username } = params;
    const user = this.findUserByUsername(Username, null, UserPoolId);
    if (!user) throw new Error(`User not found: ${Username}`);
    user.UserStatus = "RESET_REQUIRED";
    this.persistUsers();
    return {};
  }

  adminUserGlobalSignOut(params = {}) {
    const { UserPoolId, Username } = params;
    const user = this.findUserByUsername(Username, null, UserPoolId);
    if (!user) throw new Error(`User not found: ${Username}`);
    // Invalidate all sessions for this user
    for (const [id, session] of this.sessions.entries()) {
      if (session.UserId === user.UserId) {
        this.accessTokens.delete(session.AccessToken);
        this.refreshTokens.delete(session.RefreshToken);
        this.sessions.delete(id);
      }
    }
    this.persistSessions();
    return {};
  }

  adminListGroupsForUser(params = {}) {
    return { Groups: [], NextToken: null };
  }

  deleteUserPool(params) {
    const { UserPoolId } = params;

    if (!this.userPools.has(UserPoolId)) {
      throw new Error(`User pool ${UserPoolId} not found`);
    }

    this.userPools.delete(UserPoolId);
    this.persistUserPools();

    return {};
  }

  // ============ User Pool Client Operations ============

  createUserPoolClient(params) {
    const { UserPoolId, ClientName, GenerateSecret, RefreshTokenValidity, AccessTokenValidity, IdTokenValidity, AllowedOAuthFlows, AllowedOAuthScopes, CallbackURLs, LogoutURLs } = params;

    const userPool = this.userPools.get(UserPoolId);
    if (!userPool) {
      throw new Error(`User pool ${UserPoolId} not found`);
    }

    const clientId = crypto.randomBytes(20).toString("hex");
    const clientSecret = GenerateSecret ? crypto.randomBytes(32).toString("hex") : null;

    const client = {
      ClientId: clientId,
      ClientName: ClientName,
      ClientSecret: clientSecret,
      UserPoolId: UserPoolId,
      RefreshTokenValidity: RefreshTokenValidity || 30,
      AccessTokenValidity: AccessTokenValidity || 1,
      IdTokenValidity: IdTokenValidity || 1,
      AllowedOAuthFlows: AllowedOAuthFlows || ["code"],
      AllowedOAuthScopes: AllowedOAuthScopes || ["openid", "email", "profile"],
      CallbackURLs: CallbackURLs || [],
      LogoutURLs: LogoutURLs || [],
      CreatedDate: new Date().toISOString(),
      LastModifiedDate: new Date().toISOString(),
    };

    userPool.Clients.set(clientId, client);
    this.persistUserPools();

    logger.debug(`✅ User Pool Client criado: ${ClientName} (${clientId})`);

    return {
      UserPoolClient: {
        ClientId: client.ClientId,
        ClientName: client.ClientName,
        ClientSecret: client.ClientSecret,
        UserPoolId: client.UserPoolId,
        RefreshTokenValidity: client.RefreshTokenValidity,
        AccessTokenValidity: client.AccessTokenValidity,
        IdTokenValidity: client.IdTokenValidity,
        AllowedOAuthFlows: client.AllowedOAuthFlows,
        AllowedOAuthScopes: client.AllowedOAuthScopes,
        CallbackURLs: client.CallbackURLs,
        LogoutURLs: client.LogoutURLs,
        CreationDate: client.CreatedDate,
      },
    };
  }

  // ============ User Operations ============

  async signUp(params = {}) {
    const { ClientId, Username, Password, UserAttributes, ValidationData } = params;

    // Encontra o user pool pelo client id
    const userPool = this.findUserPoolByClientId(ClientId);
    if (!userPool) {
      throw new Error(`Client ${ClientId} not found`);
    }

    // Verifica se usuário já existe
    const existingUser = Array.from(this.users.values()).find((u) => u.Username === Username && u.UserPoolId === userPool.Id);

    if (existingUser) {
      throw new Error(`User already exists: ${Username}`);
    }

    const userId = uuidv4();
    const confirmationCode = Math.floor(100000 + Math.random() * 900000).toString();

    const user = {
      Username: Username,
      UserPoolId: userPool.Id,
      UserId: userId,
      Attributes: this.normalizeUserAttributes(UserAttributes || []),
      Enabled: true,
      UserStatus: "UNCONFIRMED",
      CreatedDate: new Date().toISOString(),
      LastModifiedDate: new Date().toISOString(),
      Password: this.hashPassword(Password),
      ConfirmationCode: confirmationCode,
      MfaOptions: [],
      PreferredMfaSetting: null,
      UserMFASettingList: [],
    };

    // Invoke PreSignUp trigger before persisting the user
    const event = this._buildTriggerEvent("PreSignUp_SignUp", userPool, user, ClientId, {
      userAttributes: this.normalizeUserAttributes(UserAttributes || []),
      validationData: ValidationData || {},
      clientMetadata: {},
    });
    const triggerResponse = await this._invokeTrigger(userPool, "PreSignUp", event);

    if (triggerResponse !== null) {
      if (triggerResponse.response?.autoConfirmUser === true) {
        user.UserStatus = "CONFIRMED";
        delete user.ConfirmationCode;
      }
      if (triggerResponse.response?.autoVerifyEmail === true) {
        user.Attributes.email_verified = "true";
      }
    }

    this.users.set(userId, user);
    userPool.Users.push(userId);
    userPool.EstimatedNumberOfUsers++;
    this.persistUsers();
    this.persistUserPools();

    const userEmail = user.Attributes.email || Username;

    if (user.UserStatus === "UNCONFIRMED") {
      logger.info(`📧 [COGNITO] Código de confirmação para "${Username}": ${confirmationCode}`);
    }

    logger.debug(`✅ Usuário criado: ${Username} (${userId}) — status: ${user.UserStatus}`);

    // PostConfirmation — dispara se usuário foi auto-confirmado pelo PreSignUp
    if (user.UserStatus === "CONFIRMED") {
      const postConfirmEvent = this._buildTriggerEvent("PostConfirmation_ConfirmSignUp", userPool, user, ClientId, {
        userAttributes: this._triggerUserAttributes(user),
      });
      try {
        await this._invokeTrigger(userPool, "PostConfirmation", postConfirmEvent);
      } catch (err) {
        logger.error(`PostConfirmation trigger error (ignored): ${err.message}`);
      }
    }

    return {
      UserConfirmed: user.UserStatus === "CONFIRMED",
      UserSub: userId,
      CodeDeliveryDetails: user.UserStatus === "UNCONFIRMED"
        ? { Destination: userEmail, DeliveryMedium: "EMAIL", AttributeName: "email" }
        : null,
    };
  }

  async confirmSignUp(params) {
    const { ClientId, Username, ConfirmationCode } = params;

    const userPool = this.findUserPoolByClientId(ClientId);
    if (!userPool) {
      throw new Error(`Client ${ClientId} not found`);
    }

    const user = this.findUserByUsername(Username, ClientId);
    if (!user) {
      throw new Error(`User not found: ${Username}`);
    }

    if (user.ConfirmationCode && user.ConfirmationCode !== ConfirmationCode) {
      throw new Error("Invalid verification code provided, please try again.");
    }

    user.UserStatus = "CONFIRMED";
    user.LastModifiedDate = new Date().toISOString();
    delete user.ConfirmationCode;
    this.persistUsers();

    const event = this._buildTriggerEvent("PostConfirmation_ConfirmSignUp", userPool, user, ClientId, {
      userAttributes: this._triggerUserAttributes(user),
    });
    try {
      await this._invokeTrigger(userPool, "PostConfirmation", event);
    } catch (err) {
      logger.error(`PostConfirmation trigger error (ignored): ${err.message}`);
    }

    return {};
  }

  async initiateAuth(params) {
    const { AuthFlow, ClientId, AuthParameters } = params;
    const userPool = this.findUserPoolByClientId(ClientId);

    if (!userPool) {
      throw new Error(`Client ${ClientId} not found`);
    }

    // CUSTOM_AUTH flow — no password check, challenge-based
    if (AuthFlow === "CUSTOM_AUTH") {
      const username = AuthParameters.USERNAME;
      const user = this.findUserByUsername(username, ClientId);
      if (!user) {
        throw new Error(`User not found: ${username}`);
      }

      // 1. PreAuthentication — dispara antes de qualquer challenge
      const preAuthEvent = this._buildTriggerEvent("PreAuthentication_Authentication", userPool, user, ClientId, {
        userAttributes: this._triggerUserAttributes(user),
        validationData: AuthParameters.ValidationData || {},
      });
      await this._invokeTrigger(userPool, "PreAuthentication", preAuthEvent);

      // 2. DefineAuthChallenge — define qual challenge usar
      const defineEvent = this._buildTriggerEvent("DefineAuthChallenge_Authentication", userPool, user, ClientId, {
        session: [],
      });
      const defineResponse = await this._invokeTrigger(userPool, "DefineAuthChallenge", defineEvent);

      if (defineResponse?.response?.challengeName === "CUSTOM_CHALLENGE") {
        const createEvent = this._buildTriggerEvent("CreateAuthChallenge_Authentication", userPool, user, ClientId, {
          challengeName: "CUSTOM_CHALLENGE",
          session: [],
        });
        const createResponse = await this._invokeTrigger(userPool, "CreateAuthChallenge", createEvent);

        const sessionToken = uuidv4();
        this.customAuthSessions.set(sessionToken, {
          sessionToken,
          userId: user.UserId,
          userPoolId: userPool.Id,
          clientId: ClientId,
          session: [],
          privateChallengeParameters: createResponse?.response?.privateChallengeParameters || {},
        });

        return {
          ChallengeName: "CUSTOM_CHALLENGE",
          ChallengeParameters: createResponse?.response?.publicChallengeParameters || {},
          Session: sessionToken,
          AuthenticationResult: null,
        };
      }

      // DefineAuthChallenge did not return CUSTOM_CHALLENGE — nothing to do
      return {
        ChallengeName: null,
        ChallengeParameters: {},
        Session: null,
        AuthenticationResult: null,
      };
    }

    const username = AuthParameters.USERNAME;
    const password = AuthParameters.PASSWORD;

    const user = this.findUserByUsername(username, ClientId);
    if (!user) {
      throw new Error(`User not found: ${username}`);
    }

    // FORCE_CHANGE_PASSWORD — validate temp password then return NEW_PASSWORD_REQUIRED challenge
    if (user.UserStatus === "FORCE_CHANGE_PASSWORD") {
      if (!this.verifyPassword(password, user.Password)) {
        throw new Error("Incorrect username or password");
      }
      const sessionToken = uuidv4();
      this.customAuthSessions.set(sessionToken, {
        sessionToken,
        userId: user.UserId,
        userPoolId: userPool.Id,
        clientId: ClientId,
        challenge: "NEW_PASSWORD_REQUIRED",
      });
      return {
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        ChallengeParameters: {
          USER_ID_FOR_SRP: user.Username,
          requiredAttributes: "[]",
          userAttributes: JSON.stringify(this._triggerUserAttributes(user)),
        },
        Session: sessionToken,
        AuthenticationResult: null,
      };
    }

    if (user.UserStatus !== "CONFIRMED") {
      // Valida senha antes de revelar o status — igual ao Cognito real
      if (!this.verifyPassword(password, user.Password)) {
        throw new Error("Incorrect username or password");
      }
      const err = new Error("User is not confirmed.");
      err.code = "UserNotConfirmedException";
      throw err;
    }

    // 1. PreAuthentication — dispara antes de validar senha
    const preAuthEvent = this._buildTriggerEvent("PreAuthentication_Authentication", userPool, user, ClientId, {
      userAttributes: this._triggerUserAttributes(user),
      validationData: AuthParameters.ValidationData || {},
    });
    await this._invokeTrigger(userPool, "PreAuthentication", preAuthEvent);

    // 2. Valida senha
    if (!this.verifyPassword(password, user.Password)) {
      throw new Error("Incorrect username or password");
    }

    // 3. PreTokenGeneration — dispara antes de gerar tokens, pode sobrescrever claims
    const preTokenEvent = this._buildTriggerEvent("TokenGeneration_Authentication", userPool, user, ClientId, {
      userAttributes: this._triggerUserAttributes(user),
      groupConfiguration: { groupsToOverride: [], iamRolesToOverride: [], preferredRole: null },
    });
    const preTokenResponse = await this._invokeTrigger(userPool, "PreTokenGeneration", preTokenEvent);
    const claimsOverride = preTokenResponse?.response?.claimsOverrideDetails || null;

    // 4. Gera tokens com claims override se houver
    const accessToken = this.generateAccessToken(user, userPool, ClientId);
    const idToken = this.generateIdToken(user, userPool, ClientId, claimsOverride);
    const refreshToken = this.generateRefreshToken(user, userPool, ClientId);

    const sessionId = uuidv4();
    const session = {
      Id: sessionId,
      UserId: user.UserId,
      UserPoolId: userPool.Id,
      ClientId: ClientId,
      AccessToken: accessToken,
      IdToken: idToken,
      RefreshToken: refreshToken,
      CreatedAt: new Date().toISOString(),
      ExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    this.sessions.set(sessionId, session);
    this.accessTokens.set(accessToken, session);
    this.refreshTokens.set(refreshToken, session);
    this.persistSessions();

    // 5. PostAuthentication — dispara após auth bem-sucedida (não bloqueia)
    const postAuthEvent = this._buildTriggerEvent("PostAuthentication_Authentication", userPool, user, ClientId, {
      userAttributes: this._triggerUserAttributes(user),
      newDeviceUsed: false,
    });
    try {
      await this._invokeTrigger(userPool, "PostAuthentication", postAuthEvent);
    } catch (err) {
      logger.error(`PostAuthentication trigger error (ignored): ${err.message}`);
    }

    logger.debug(`🔐 Usuário autenticado: ${username}`);
    this.audit.record({
      eventName: "InitiateAuth",
      readOnly: false,
      resources: [{ ARN: userPool.Arn, type: "AWS::Cognito::UserPool" }],
      requestParameters: { clientId: ClientId, authFlow: AuthFlow },
    });

    return {
      AuthenticationResult: {
        AccessToken: accessToken,
        IdToken: idToken,
        RefreshToken: refreshToken,
        TokenType: "Bearer",
        ExpiresIn: 3600,
      },
      ChallengeName: null,
      Session: null,
    };
  }

  getToken(params) {
    const { AuthFlow, ClientId, AuthParameters } = params;

    if (AuthFlow === "REFRESH_TOKEN_AUTH") {
      const refreshToken = AuthParameters.REFRESH_TOKEN;
      const session = this.refreshTokens.get(refreshToken);

      if (!session) {
        throw new Error("Invalid refresh token");
      }

      const user = this.users.get(session.UserId);
      const userPool = this.userPools.get(session.UserPoolId);

      if (!user || !userPool) {
        throw new Error("Invalid session");
      }

      // Gera novos tokens
      const newAccessToken = this.generateAccessToken(user, userPool, session.ClientId);
      const newIdToken = this.generateIdToken(user, userPool, session.ClientId);

      session.AccessToken = newAccessToken;
      session.IdToken = newIdToken;
      session.ExpiresAt = new Date(Date.now() + 3600000).toISOString();

      this.accessTokens.set(newAccessToken, session);
      this.persistSessions();

      return {
        AuthenticationResult: {
          AccessToken: newAccessToken,
          IdToken: newIdToken,
          TokenType: "Bearer",
          ExpiresIn: 3600,
        },
      };
    }

    throw new Error(`Unsupported AuthFlow: ${AuthFlow}`);
  }

  // ============ Token Management ============

  generateAccessToken(user, userPool, clientId) {
    const payload = {
      sub: user.UserId,
      token_use: "access",
      client_id: clientId,
      username: user.Username,
      scope: "aws.cognito.signin.user.admin",
      iss: `https://cognito-idp.local/${userPool.Id}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };

    return jwt.sign(payload, this.jwtSecret, { algorithm: "HS256" });
  }

  generateIdToken(user, userPool, clientId, claimsOverride = null) {
    const payload = {
      sub: user.UserId,
      token_use: "id",
      client_id: clientId,
      email: user.Attributes.email,
      email_verified: user.Attributes.email_verified || true,
      username: user.Username,
      iss: `https://cognito-idp.local/${userPool.Id}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    };

    // Adiciona outros atributos do usuário
    for (const [key, value] of Object.entries(user.Attributes)) {
      if (key !== "email" && key !== "email_verified") {
        payload[key] = value;
      }
    }

    // Apply PreTokenGeneration claims override
    if (claimsOverride !== null) {
      if (claimsOverride.claimsToAddOrOverride) {
        Object.assign(payload, claimsOverride.claimsToAddOrOverride);
      }
      if (Array.isArray(claimsOverride.claimsToSuppress)) {
        for (const key of claimsOverride.claimsToSuppress) {
          delete payload[key];
        }
      }
    }

    return jwt.sign(payload, this.jwtSecret, { algorithm: "HS256" });
  }

  generateRefreshToken(user, userPool, clientId) {
    const payload = {
      sub: user.UserId,
      token_use: "refresh",
      client_id: clientId,
      username: user.Username,
      iss: `https://cognito-idp.local/${userPool.Id}`,
      exp: Math.floor(Date.now() / 1000) + 2592000, // 30 dias
      iat: Math.floor(Date.now() / 1000),
    };

    return jwt.sign(payload, this.jwtSecret, { algorithm: "HS256" });
  }

  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      const session = this.accessTokens.get(token);

      if (!session || session.ExpiresAt < new Date().toISOString()) {
        return null;
      }

      return decoded;
    } catch (error) {
      return null;
    }
  }

  // ============ Admin Operations ============

  adminGetUser(params) {
    const { UserPoolId, Username } = params;
    const userPool = this.userPools.get(UserPoolId);

    if (!userPool) {
      throw new Error(`User pool ${UserPoolId} not found`);
    }

    const user = this.findUserByUsername(Username, null, UserPoolId);
    if (!user) {
      throw new Error(`User not found: ${Username}`);
    }

    return {
      Username: user.Username,
      UserAttributes: this._formatUserAttributesWithSub(user),
      UserCreateDate: user.CreatedDate,
      UserLastModifiedDate: user.LastModifiedDate,
      Enabled: user.Enabled,
      UserStatus: user.UserStatus,
      MFAOptions: user.MfaOptions,
      PreferredMfaSetting: user.PreferredMfaSetting,
      UserMFASettingList: user.UserMFASettingList,
    };
  }

  adminCreateUser(params) {
    const { UserPoolId, Username, UserAttributes, TemporaryPassword, DesiredDeliveryMediums } = params;
    const userPool = this.userPools.get(UserPoolId);

    if (!userPool) {
      throw new Error(`User pool ${UserPoolId} not found`);
    }

    const tempPassword = TemporaryPassword || this._generateTemporaryPassword();

    const userId = uuidv4();
    const user = {
      Username: Username,
      UserPoolId: UserPoolId,
      UserId: userId,
      Attributes: this.normalizeUserAttributes(UserAttributes || []),
      Enabled: true,
      UserStatus: "FORCE_CHANGE_PASSWORD",
      CreatedDate: new Date().toISOString(),
      LastModifiedDate: new Date().toISOString(),
      Password: this.hashPassword(tempPassword),
      MfaOptions: [],
      PreferredMfaSetting: null,
      UserMFASettingList: [],
    };

    // PreSignUp trigger — dispara antes de criar o usuário (admin context)
    const preSignUpEvent = this._buildTriggerEvent("PreSignUp_AdminCreateUser", userPool, user, "ADMIN", {
      userAttributes: this.normalizeUserAttributes(UserAttributes || []),
      validationData: {},
      clientMetadata: {},
    });
    // Fire and forget — AdminCreateUser PreSignUp errors are non-blocking in local sim
    this._invokeTrigger(userPool, "PreSignUp", preSignUpEvent).catch((err) => {
      logger.warn(`PreSignUp trigger error on AdminCreateUser (ignored): ${err.message}`);
    });

    this.users.set(userId, user);
    userPool.Users.push(userId);
    userPool.EstimatedNumberOfUsers++;
    this.persistUsers();
    this.persistUserPools();

    logger.info(`👤 Usuário criado: ${Username} | Senha temporária: ${tempPassword}`);

    return {
      User: {
        Username: user.Username,
        UserAttributes: this._formatUserAttributesWithSub(user),
        UserCreateDate: user.CreatedDate,
        UserLastModifiedDate: user.LastModifiedDate,
        Enabled: user.Enabled,
        UserStatus: user.UserStatus,
        TemporaryPassword: tempPassword,
      },
    };
  }

  _generateTemporaryPassword() {
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const digits = "0123456789";
    const special = "!@#$%^&*";
    const all = upper + lower + digits + special;
    const rand = (set) => set[Math.floor(Math.random() * set.length)];
    const password = [rand(upper), rand(lower), rand(digits), rand(special)];
    for (let i = 4; i < 10; i++) password.push(rand(all));
    return password.sort(() => Math.random() - 0.5).join("");
  }

  adminSetUserPassword(params) {
    const { UserPoolId, Username, Password, Permanent } = params;
    const user = this.findUserByUsername(Username, null, UserPoolId);

    if (!user) {
      throw new Error(`User not found: ${Username}`);
    }

    user.Password = this.hashPassword(Password);
    if (Permanent) {
      user.UserStatus = "CONFIRMED";
    }
    user.LastModifiedDate = new Date().toISOString();
    this.persistUsers();

    return {};
  }

  adminDeleteUser(params) {
    const { UserPoolId, Username } = params;
    const user = this.findUserByUsername(Username, null, UserPoolId);

    if (!user) {
      throw new Error(`User not found: ${Username}`);
    }

    const userPool = this.userPools.get(UserPoolId);
    if (userPool) {
      const index = userPool.Users.indexOf(user.UserId);
      if (index !== -1) {
        userPool.Users.splice(index, 1);
        userPool.EstimatedNumberOfUsers--;
      }
    }

    this.users.delete(user.UserId);
    this.persistUsers();
    this.persistUserPools();

    return {};
  }

  // ============ Helper Methods ============

  findUserPoolByClientId(clientId) {
    for (const userPool of this.userPools.values()) {
      if (userPool.Clients.has(clientId)) {
        return userPool;
      }
    }
    return null;
  }

  findUserByUsername(username, clientId = null, userPoolId = null) {
    let targetUserPoolId = userPoolId;

    if (clientId && !targetUserPoolId) {
      const userPool = this.findUserPoolByClientId(clientId);
      if (userPool) {
        targetUserPoolId = userPool.Id;
      }
    }

    for (const user of this.users.values()) {
      if (user.UserPoolId !== targetUserPoolId) continue;
      // Match by Username or by email attribute (when UsernameAttributes includes 'email')
      if (user.Username === username) return user;
      if (user.Attributes?.email === username) return user;
    }

    return null;
  }

  normalizeUserAttributes(attributes) {
    const normalized = {};
    for (const attr of attributes) {
      normalized[attr.Name] = attr.Value;
    }
    return normalized;
  }

  formatUserAttributes(attributes) {
    return Object.entries(attributes).map(([Name, Value]) => ({ Name, Value }));
  }

  _formatUserAttributesWithSub(user) {
    const attrs = this.formatUserAttributes(user.Attributes);
    if (!attrs.find(a => a.Name === 'sub')) {
      attrs.unshift({ Name: 'sub', Value: user.UserId });
    }
    return attrs;
  }

  hashPassword(password) {
    // Simulação de hash (não usar em produção real)
    return crypto.createHash("sha256").update(password).digest("hex");
  }

  verifyPassword(password, hash) {
    return this.hashPassword(password) === hash;
  }

  // ============ Identity Pool Operations ============

  createIdentityPool(params) {
    const { IdentityPoolName, AllowUnauthenticatedIdentities, SupportedLoginProviders, CognitoIdentityProviders } = params;

    const identityPoolId = `local:${IdentityPoolName}_${Date.now()}`;
    const identityPool = {
      IdentityPoolId: identityPoolId,
      IdentityPoolName: IdentityPoolName,
      AllowUnauthenticatedIdentities: AllowUnauthenticatedIdentities || false,
      SupportedLoginProviders: SupportedLoginProviders || {},
      CognitoIdentityProviders: CognitoIdentityProviders || [],
      Identities: new Map(),
    };

    this.identityPools.set(identityPoolId, identityPool);
    this.persistIdentityPools();

    logger.debug(`✅ Identity Pool criado: ${IdentityPoolName} (${identityPoolId})`);

    return {
      IdentityPoolId: identityPoolId,
      IdentityPoolName: identityPoolName,
      AllowUnauthenticatedIdentities: identityPool.AllowUnauthenticatedIdentities,
    };
  }

  getId(params) {
    const { IdentityPoolId, Logins } = params;
    const identityPool = this.identityPools.get(IdentityPoolId);

    if (!identityPool) {
      throw new Error(`Identity pool ${IdentityPoolId} not found`);
    }

    let identityId = null;

    if (Logins) {
      // Procura identidade existente com os logins fornecidos
      for (const [id, identity] of identityPool.Identities) {
        if (identity.Logins && this.matchesLogins(identity.Logins, Logins)) {
          identityId = id;
          break;
        }
      }
    }

    if (!identityId) {
      identityId = uuidv4();
      identityPool.Identities.set(identityId, {
        IdentityId: identityId,
        Logins: Logins || {},
        CreationDate: new Date().toISOString(),
        LastModifiedDate: new Date().toISOString(),
      });
      this.persistIdentityPools();
    }

    return {
      IdentityId: identityId,
    };
  }

  getCredentialsForIdentity(params) {
    const { IdentityId, Logins } = params;
    const identityPool = this.findIdentityPoolByIdentityId(IdentityId);

    if (!identityPool) {
      throw new Error(`Identity ${IdentityId} not found`);
    }

    const identity = identityPool.Identities.get(IdentityId);
    if (!identity) {
      throw new Error(`Identity ${IdentityId} not found in pool`);
    }

    // Gera credenciais temporárias (simuladas)
    const credentials = {
      AccessKeyId: `AKIA${crypto.randomBytes(16).toString("hex").toUpperCase()}`,
      SecretKey: crypto.randomBytes(32).toString("hex"),
      SessionToken: crypto.randomBytes(64).toString("base64"),
      Expiration: new Date(Date.now() + 3600000).toISOString(),
    };

    return {
      Credentials: credentials,
      IdentityId: IdentityId,
    };
  }

  findIdentityPoolByIdentityId(identityId) {
    for (const pool of this.identityPools.values()) {
      if (pool.Identities.has(identityId)) {
        return pool;
      }
    }
    return null;
  }

  matchesLogins(existingLogins, newLogins) {
    const existingKeys = Object.keys(existingLogins);
    const newKeys = Object.keys(newLogins);

    if (existingKeys.length !== newKeys.length) return false;

    for (const key of existingKeys) {
      if (existingLogins[key] !== newLogins[key]) {
        return false;
      }
    }

    return true;
  }

  // ============ Persistence ============

  loadUserPools() {
    // Load persisted pools first
    const saved = this.store.read("__userpools__");
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        data.Clients = new Map(Object.entries(data.Clients || {}));
        data.Groups = new Map(Object.entries(data.Groups || {}));
        data.IdentityProviders = new Map(Object.entries(data.IdentityProviders || {}));
        data.ResourceServers = new Map(Object.entries(data.ResourceServers || {}));
        this.userPools.set(id, data);
      }
    }

    // Create user pools from config if not already persisted
    if (this.config.cognito?.userPools) {
      let configChanged = false;
      const configPath = this.config._configPath;

      for (let i = 0; i < this.config.cognito.userPools.length; i++) {
        const poolConfig = this.config.cognito.userPools[i];
        const existing = Array.from(this.userPools.values()).find((p) => p.Name === poolConfig.PoolName);

        if (!existing) {
          const result = this.createUserPool(poolConfig);
          const poolId = result.UserPool.Id;
          logger.debug(`✅ User Pool criado a partir da config: ${poolConfig.PoolName} (${poolId})`);

          // Copy LambdaTriggers from config onto the pool object
          const pool = this.userPools.get(poolId);
          pool.LambdaTriggers = poolConfig.LambdaTriggers || {};

          // Auto-create a default client if not specified
          if (!poolConfig.ClientId) {
            const clientResult = this.createUserPoolClient({
              UserPoolId: poolId,
              ClientName: `${poolConfig.PoolName}-client`,
              GenerateSecret: false,
            });
            const clientId = clientResult.UserPoolClient.ClientId;
            this.config.cognito.userPools[i].ClientId = clientId;
            this.config.cognito.userPools[i].UserPoolId = poolId;
            configChanged = true;
            logger.debug(`✅ Client criado automaticamente: ${clientId}`);
          }
        } else {
          // Pool already exists — apply LambdaTriggers from config
          existing.LambdaTriggers = poolConfig.LambdaTriggers || {};

          if (!poolConfig.ClientId) {
            // Pool exists but no clientId in config — write it back
            const firstClient = existing.Clients.size > 0 ? existing.Clients.values().next().value : null;
            if (firstClient) {
              this.config.cognito.userPools[i].ClientId = firstClient.ClientId;
              this.config.cognito.userPools[i].UserPoolId = existing.Id;
              configChanged = true;
            }
          } else if (!existing.Clients.has(poolConfig.ClientId)) {
            // ClientId is in config but not in the pool's Clients map — register it
            existing.Clients.set(poolConfig.ClientId, {
              ClientId: poolConfig.ClientId,
              ClientName: `${poolConfig.PoolName}-client`,
              ClientSecret: null,
              UserPoolId: existing.Id,
              RefreshTokenValidity: 30,
              AccessTokenValidity: 1,
              IdTokenValidity: 1,
              AllowedOAuthFlows: ['code'],
              AllowedOAuthScopes: ['openid', 'email', 'profile'],
              CallbackURLs: [],
              LogoutURLs: [],
              CreatedDate: new Date().toISOString(),
              LastModifiedDate: new Date().toISOString(),
            });
            this.persistUserPools();
            logger.debug(`✅ ClientId ${poolConfig.ClientId} registrado no pool ${existing.Id}`);
          }
        }
      }

      // Write clientId back to aws-local-simulator.json
      if (configChanged && configPath) {
        try {
          const fs = require("fs");
          const fileContent = JSON.parse(fs.readFileSync(configPath, "utf8"));
          fileContent.cognito = fileContent.cognito || {};
          fileContent.cognito.userPools = this.config.cognito.userPools.map((p) => ({
            PoolName: p.PoolName,
            AutoVerifiedAttributes: p.AutoVerifiedAttributes,
            UserPoolId: p.UserPoolId,
            ClientId: p.ClientId,
          }));
          fs.writeFileSync(configPath, JSON.stringify(fileContent, null, 2));
          logger.info(`✅ ClientId gravado em: ${configPath}`);
        } catch (err) {
          logger.warn(`⚠️ Não foi possível gravar clientId no config: ${err.message}`);
        }
      }
    }
  }

  loadIdentityPools() {
    const saved = this.store.read("__identitypools__");
    if (saved) {
      for (const [id, data] of Object.entries(saved)) {
        data.Identities = new Map(Object.entries(data.Identities || {}));
        this.identityPools.set(id, data);
      }
    }
  }

  loadUsers() {
    const saved = this.store.read("__users__");
    if (saved) {
      for (const [id, user] of Object.entries(saved)) {
        this.users.set(id, user);
      }
    }
  }

  loadSessions() {
    const saved = this.store.read("__sessions__");
    if (saved) {
      for (const [id, session] of Object.entries(saved)) {
        this.sessions.set(id, session);
        this.accessTokens.set(session.AccessToken, session);
        this.refreshTokens.set(session.RefreshToken, session);
      }
    }
  }

  persistUserPools() {
    const poolsObj = {};
    for (const [id, pool] of this.userPools.entries()) {
      poolsObj[id] = {
        ...pool,
        Clients: Object.fromEntries(pool.Clients),
        Groups: Object.fromEntries(pool.Groups),
        IdentityProviders: Object.fromEntries(pool.IdentityProviders),
        ResourceServers: Object.fromEntries(pool.ResourceServers),
      };
    }
    this.store.write("__userpools__", poolsObj);
  }

  persistIdentityPools() {
    const poolsObj = {};
    for (const [id, pool] of this.identityPools.entries()) {
      poolsObj[id] = {
        ...pool,
        Identities: Object.fromEntries(pool.Identities),
      };
    }
    this.store.write("__identitypools__", poolsObj);
  }

  persistUsers() {
    const usersObj = {};
    for (const [id, user] of this.users.entries()) {
      usersObj[id] = user;
    }
    this.store.write("__users__", usersObj);
  }

  persistSessions() {
    const sessionsObj = {};
    for (const [id, session] of this.sessions.entries()) {
      sessionsObj[id] = session;
    }
    this.store.write("__sessions__", sessionsObj);
  }

  async reset() {
    this.userPools.clear();
    this.identityPools.clear();
    this.users.clear();
    this.sessions.clear();
    this.accessTokens.clear();
    this.refreshTokens.clear();

    this.persistUserPools();
    this.persistIdentityPools();
    this.persistUsers();
    this.persistSessions();

    logger.debug("Cognito: Todos os dados resetados");
  }

  // ============ Stats ============

  getUserPoolsCount() {
    return this.userPools.size;
  }

  getTotalUsersCount() {
    return this.users.size;
  }

  getIdentityPoolsCount() {
    return this.identityPools.size;
  }

  getActiveSessionsCount() {
    return this.sessions.size;
  }
}

module.exports = CognitoSimulator;
