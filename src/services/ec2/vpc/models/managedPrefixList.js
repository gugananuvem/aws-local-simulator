/**
 * Managed Prefix List Model
 *
 * Lista de prefixos gerenciada (CIDRs) reutilizável em regras de segurança,
 * tabelas de rotas etc. Na AWS é identificada por `pl-<17 hex>` e possui um
 * ARN no formato `arn:aws:ec2:<region>:<accountId>:prefix-list/<id>`.
 *
 * As listas padrão (owner `AWS`, ex.: `com.amazonaws.<region>.s3`) não podem
 * ser excluídas pelo usuário.
 */
const { generateResourceId } = require('./identifier');

const OWNER_ID = '123456789012';
const REGION = 'us-east-1';

class ManagedPrefixList {
  /**
   * @param {object} config
   * @param {string} config.PrefixListName
   * @param {string} [config.AddressFamily] IPv4 | IPv6
   * @param {number} [config.MaxEntries]
   * @param {Array<{Cidr: string, Description?: string}>} [config.Entries]
   * @param {Array} [config.Tags]
   * @param {string} [config.OwnerId]
   */
  constructor(config = {}) {
    this.PrefixListId = generateResourceId('pl');
    this.PrefixListName = config.PrefixListName || '';
    this.AddressFamily = config.AddressFamily || 'IPv4';
    this.MaxEntries = Number(config.MaxEntries) || 5;
    this.State = config.State || 'create-complete';
    this.Version = Number(config.Version) || 1;
    this.OwnerId = config.OwnerId || OWNER_ID;
    this.PrefixListArn =
      config.PrefixListArn ||
      `arn:aws:ec2:${REGION}:${this.OwnerId}:prefix-list/${this.PrefixListId}`;
    this.Entries = config.Entries || [];
    this.Tags = config.Tags || [];
  }

  /**
   * Lista padrão equivalente à que a AWS disponibiliza por região (S3 gateway).
   * Pertence à AWS (OwnerId `AWS`) e por isso não pode ser removida.
   */
  static defaultPrefixList() {
    return new ManagedPrefixList({
      PrefixListName: `com.amazonaws.${REGION}.s3`,
      AddressFamily: 'IPv4',
      MaxEntries: 1,
      Entries: [{ Cidr: '0.0.0.0/0', Description: 'S3 gateway endpoint' }],
      OwnerId: 'AWS'
    });
  }

  isRemovable() {
    return this.OwnerId !== 'AWS';
  }

  toJSON() {
    return {
      PrefixListId: this.PrefixListId,
      PrefixListName: this.PrefixListName,
      AddressFamily: this.AddressFamily,
      MaxEntries: this.MaxEntries,
      State: this.State,
      Version: this.Version,
      OwnerId: this.OwnerId,
      PrefixListArn: this.PrefixListArn,
      Entries: this.Entries,
      Tags: this.Tags
    };
  }

  static fromJSON(data = {}) {
    const list = Object.create(ManagedPrefixList.prototype);
    list.PrefixListId = data.PrefixListId || generateResourceId('pl');
    list.PrefixListName = data.PrefixListName || '';
    list.AddressFamily = data.AddressFamily || 'IPv4';
    list.MaxEntries = Number(data.MaxEntries) || 5;
    list.State = data.State || 'create-complete';
    list.Version = Number(data.Version) || 1;
    list.OwnerId = data.OwnerId || OWNER_ID;
    list.PrefixListArn =
      data.PrefixListArn ||
      `arn:aws:ec2:${REGION}:${list.OwnerId}:prefix-list/${list.PrefixListId}`;
    list.Entries = data.Entries || [];
    list.Tags = data.Tags || [];
    return list;
  }
}

module.exports = ManagedPrefixList;
