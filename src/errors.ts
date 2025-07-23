export class NotYetImplemented extends Error {
  constructor(feature: string) {
    super(`${feature} not yet implemented`)
    this.name = 'NotYetImplemented'
  }
}
