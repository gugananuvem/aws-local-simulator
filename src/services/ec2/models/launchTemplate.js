/**
 * EC2 Launch Template Model
 *
 * Um launch template armazena a configuração reutilizável para lançar instâncias
 * e mantém um histórico de versões (no máximo 200, como na AWS). A versão
 * marcada como padrão é usada quando nenhuma versão é informada.
 */

const { v4: uuidv4 } = require('uuid');

const MAX_VERSIONS = 200;

/**
 * Remove chaves vazias de um objeto de configuração, mantendo apenas os campos
 * efetivamente informados no launch template data.
 */
function cleanData(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

class LaunchTemplate {
  constructor(name, data = {}, config = {}) {
    this.LaunchTemplateId = `lt-${uuidv4().replace(/-/g, '').substring(0, 17)}`;
    this.LaunchTemplateName = name;
    this.CreatedBy = config.CreatedBy || 'arn:aws:iam::123456789012:user/Alex';
    this.CreateTime = new Date().toISOString();
    this.Tags = config.Tags || [];
    this.Versions = [];
    this.DefaultVersionNumber = 0;
    this.LatestVersionNumber = 0;

    // A primeira versão é sempre a padrão.
    this.addVersion(data, config.VersionDescription || '', true);
  }

  /**
   * Adiciona uma nova versão ao template.
   *
   * @param {object} data LaunchTemplateData (camelCase)
   * @param {string} description Descrição da versão
   * @param {boolean} setAsDefault Se a nova versão passa a ser a padrão
   */
  addVersion(data, description = '', setAsDefault = false) {
    if (this.Versions.length >= MAX_VERSIONS) {
      throw new Error(
        `Launch template ${this.LaunchTemplateId} atingiu o número máximo de versões (${MAX_VERSIONS})`
      );
    }

    const versionNumber = this.LatestVersionNumber + 1;
    const version = {
      VersionNumber: versionNumber,
      VersionDescription: description || '',
      CreateTime: new Date().toISOString(),
      LaunchTemplateData: cleanData(data)
    };

    this.Versions.push(version);
    this.LatestVersionNumber = versionNumber;

    if (setAsDefault || this.DefaultVersionNumber === 0) {
      this.DefaultVersionNumber = versionNumber;
    }

    return version;
  }

  /**
   * Resolve o número de versão a partir de expressões da AWS.
   * Aceita número, '$Default', '$Latest' ou vazio (usa a padrão).
   */
  resolveVersionNumber(version) {
    if (version === undefined || version === null || version === '' || version === '$Default') {
      return this.DefaultVersionNumber;
    }
    if (version === '$Latest') {
      return this.LatestVersionNumber;
    }
    const parsed = Number(version);
    if (Number.isNaN(parsed)) {
      throw new Error(`Versão de launch template inválida: ${version}`);
    }
    return parsed;
  }

  getVersion(version) {
    const number = this.resolveVersionNumber(version);
    const found = this.Versions.find(v => v.VersionNumber === number);
    if (!found) {
      throw new Error(`Versão ${number} do launch template ${this.LaunchTemplateId} não encontrada`);
    }
    return found;
  }

  /**
   * Define a versão padrão do template.
   */
  setDefaultVersion(version) {
    const number = this.resolveVersionNumber(version);
    this.getVersion(number); // valida existência
    this.DefaultVersionNumber = number;
    return number;
  }

  /**
   * Remove uma versão. A versão padrão não pode ser removida (como na AWS).
   */
  deleteVersion(version) {
    const number = this.resolveVersionNumber(version);
    if (number === this.DefaultVersionNumber && this.Versions.length > 1) {
      throw new Error(
        `Não é possível remover a versão padrão (${number}) do launch template ${this.LaunchTemplateId}`
      );
    }

    const index = this.Versions.findIndex(v => v.VersionNumber === number);
    if (index === -1) {
      throw new Error(`Versão ${number} do launch template ${this.LaunchTemplateId} não encontrada`);
    }

    this.Versions.splice(index, 1);

    // Reajusta o DefaultVersionNumber se a versão removida era a última restante.
    if (this.Versions.length === 0) {
      this.DefaultVersionNumber = 0;
      this.LatestVersionNumber = 0;
    } else if (number > this.LatestVersionNumber) {
      this.LatestVersionNumber = this.Versions[this.Versions.length - 1].VersionNumber;
    }

    return number;
  }

  toJSON() {
    return {
      LaunchTemplateId: this.LaunchTemplateId,
      LaunchTemplateName: this.LaunchTemplateName,
      CreatedBy: this.CreatedBy,
      CreateTime: this.CreateTime,
      Tags: this.Tags,
      DefaultVersionNumber: this.DefaultVersionNumber,
      LatestVersionNumber: this.LatestVersionNumber,
      Versions: this.Versions.map(v => ({ ...v, LaunchTemplateData: { ...v.LaunchTemplateData } }))
    };
  }

  /**
   * Formato "achatado" usado por DescribeLaunchTemplateVersions.
   */
  versionToJSON(versionNumber) {
    const version = this.getVersion(versionNumber);
    return {
      LaunchTemplateId: this.LaunchTemplateId,
      LaunchTemplateName: this.LaunchTemplateName,
      VersionNumber: version.VersionNumber,
      VersionDescription: version.VersionDescription,
      CreateTime: version.CreateTime,
      CreatedBy: this.CreatedBy,
      DefaultVersion: version.VersionNumber === this.DefaultVersionNumber,
      LaunchTemplateData: { ...version.LaunchTemplateData }
    };
  }

  static fromJSON(data) {
    const template = Object.create(LaunchTemplate.prototype);
    template.LaunchTemplateId = data.LaunchTemplateId;
    template.LaunchTemplateName = data.LaunchTemplateName;
    template.CreatedBy = data.CreatedBy || 'arn:aws:iam::123456789012:user/Alex';
    template.CreateTime = data.CreateTime || new Date().toISOString();
    template.Tags = data.Tags || [];
    template.Versions = Array.isArray(data.Versions)
      ? data.Versions.map(v => ({
          VersionNumber: v.VersionNumber,
          VersionDescription: v.VersionDescription || '',
          CreateTime: v.CreateTime || new Date().toISOString(),
          LaunchTemplateData: v.LaunchTemplateData || {}
        }))
      : [];

    const numbers = template.Versions.map(v => v.VersionNumber);
    template.DefaultVersionNumber =
      data.DefaultVersionNumber || (numbers.length ? numbers[0] : 0);
    template.LatestVersionNumber =
      data.LatestVersionNumber || (numbers.length ? numbers[numbers.length - 1] : 0);

    return template;
  }
}

module.exports = LaunchTemplate;
