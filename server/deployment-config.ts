import config from './deployment-config.json';
export { config };
export function identifier(value: string) {
 if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Unsupported SQL identifier');
 return '`' + value + '`';
}
export function qualified(value: string) { return value.split('.').map(identifier).join('.'); }
