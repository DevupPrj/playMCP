import * as xml2js from 'xml2js';

export class XmlParserUtil {
  static async parseXml(xml: string): Promise<any> {
    const parser = new xml2js.Parser();
    return parser.parseStringPromise(xml);
  }
}
