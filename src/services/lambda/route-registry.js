/**
 * Route Registry - Gerencia o registro e matching de rotas para Lambdas
 * Suporta: Path parameters, Wildcards, Middlewares
 */

class RouteRegistry {
  constructor() {
    this.routes = new Map();
    this.middlewares = new Map();
    this.globalMiddlewares = [];
  }

  /**
   * Registra uma rota
   * @param {string} path - Caminho da rota (ex: /users/:id, /api/*)
   * @param {Function} handler - Função handler da Lambda
   * @param {Object} env - Variáveis de ambiente específicas
   * @param {Array} middlewares - Middlewares específicos da rota
   */
  register(path, handler, env = {}, middlewares = []) {
    // Normaliza o path
    const normalizedPath = this.normalizePath(path);
    
    // Parse do path para extrair parâmetros
    const { pattern, params } = this.parsePath(normalizedPath);
    
    this.routes.set(normalizedPath, {
      path: normalizedPath,
      pattern,
      params,
      handler,
      env,
      middlewares,
      isWildcard: normalizedPath.includes('*'),
      hasParams: params.length > 0,
      timestamp: Date.now()
    });
    
    // Adiciona versão com barra se não existir
    if (!normalizedPath.endsWith('/') && normalizedPath !== '*') {
      const slashPath = `${normalizedPath}/`;
      if (!this.routes.has(slashPath)) {
        this.routes.set(slashPath, {
          path: slashPath,
          pattern: this.parsePath(slashPath).pattern,
          params: this.parsePath(slashPath).params,
          handler,
          env,
          middlewares,
          isWildcard: false,
          hasParams: this.parsePath(slashPath).params.length > 0,
          timestamp: Date.now()
        });
      }
    }
    
    return this;
  }

  /**
   * Registra um middleware global
   */
  use(middleware) {
    this.globalMiddlewares.push(middleware);
    return this;
  }

  /**
   * Registra um middleware para uma rota específica
   */
  useFor(path, middleware) {
    const normalizedPath = this.normalizePath(path);
    if (!this.middlewares.has(normalizedPath)) {
      this.middlewares.set(normalizedPath, []);
    }
    this.middlewares.get(normalizedPath).push(middleware);
    return this;
  }

  /**
   * Encontra uma rota que corresponde ao path
   * @param {string} path - Path da requisição
   * @returns {Object|null} - Rota encontrada com parâmetros extraídos
   */
  find(path) {
    const normalizedPath = this.normalizePath(path);
    
    // Busca exata primeiro
    if (this.routes.has(normalizedPath)) {
      const route = this.routes.get(normalizedPath);
      return {
        ...route,
        params: {}
      };
    }
    
    // Busca por prefixo (para rotas sem parâmetros)
    for (const [routePath, route] of this.routes.entries()) {
      if (!route.hasParams && !route.isWildcard && normalizedPath.startsWith(routePath)) {
        return {
          ...route,
          params: {}
        };
      }
    }
    
    // Busca por padrão com parâmetros
    for (const [routePath, route] of this.routes.entries()) {
      if (route.hasParams && route.pattern) {
        const match = route.pattern.exec(normalizedPath);
        if (match) {
          const params = {};
          route.params.forEach((paramName, index) => {
            params[paramName] = match[index + 1];
          });
          return {
            ...route,
            params
          };
        }
      }
    }
    
    // Busca wildcard
    for (const [routePath, route] of this.routes.entries()) {
      if (route.isWildcard) {
        const wildcardPath = routePath.replace('*', '');
        if (normalizedPath.startsWith(wildcardPath)) {
          return {
            ...route,
            params: {
              wildcard: normalizedPath.substring(wildcardPath.length)
            }
          };
        }
      }
    }
    
    return null;
  }

  /**
   * Obtém todos os middlewares para uma rota
   */
  getMiddlewares(route) {
    const routeMiddlewares = this.middlewares.get(route.path) || [];
    return [...this.globalMiddlewares, ...routeMiddlewares, ...route.middlewares];
  }

  /**
   * Normaliza o path
   */
  normalizePath(path) {
    // Remove query string
    const pathWithoutQuery = path.split('?')[0];
    
    // Remove trailing slash
    let normalized = pathWithoutQuery.replace(/\/+$/, '');
    
    // Adiciona slash inicial se necessário
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
    
    // Se for vazio, usa root
    if (normalized === '') {
      normalized = '/';
    }
    
    return normalized;
  }

  /**
   * Parse do path para extrair parâmetros e criar regex pattern
   * @param {string} path - Path da rota (ex: /users/:id/posts/:postId)
   * @returns {Object} - { pattern, params }
   */
  parsePath(path) {
    const params = [];
    
    // Substitui :param por regex capture group
    const patternString = path.replace(/:[^\s/]+/g, (match) => {
      const paramName = match.substring(1);
      params.push(paramName);
      return '([^/]+)';
    });
    
    // Substitui * por regex wildcard
    const finalPatternString = patternString.replace(/\*/g, '(.*)');
    
    // Cria regex
    const pattern = new RegExp(`^${finalPatternString}$`);
    
    return { pattern, params };
  }

  /**
   * Remove uma rota
   */
  unregister(path) {
    const normalizedPath = this.normalizePath(path);
    this.routes.delete(normalizedPath);
    return this;
  }

  /**
   * Lista todas as rotas
   */
  list() {
    const routes = [];
    for (const [path, route] of this.routes.entries()) {
      routes.push({
        path,
        handler: route.handler.name || 'anonymous',
        hasParams: route.hasParams,
        isWildcard: route.isWildcard,
        params: route.params,
        env: route.env
      });
    }
    return routes;
  }

  /**
   * Limpa todas as rotas
   */
  clear() {
    this.routes.clear();
    this.middlewares.clear();
    this.globalMiddlewares = [];
    return this;
  }

  /**
   * Verifica se uma rota existe
   */
  has(path) {
    const normalizedPath = this.normalizePath(path);
    return this.routes.has(normalizedPath) || this.find(path) !== null;
  }

  /**
   * Obtém todas as rotas em formato de objeto
   */
  getAll() {
    const result = {};
    for (const [path, route] of this.routes.entries()) {
      result[path] = {
        handler: route.handler,
        env: route.env,
        hasParams: route.hasParams,
        params: route.params
      };
    }
    return result;
  }

  /**
   * Obtém estatísticas das rotas
   */
  getStats() {
    const routes = Array.from(this.routes.values());
    return {
      total: routes.length,
      withParams: routes.filter(r => r.hasParams).length,
      wildcards: routes.filter(r => r.isWildcard).length,
      routes: routes.map(r => ({
        path: r.path,
        handler: r.handler.name || 'anonymous'
      }))
    };
  }
}

module.exports = RouteRegistry;