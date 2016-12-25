import Exception from '../exception';

function validateClose(open, close) {
  close = close.path ? close.path.original : close;

  if (open.path.original !== close) {
    let errorNode = {loc: open.path.loc};

    throw new Exception(open.path.original + " doesn't match " + close, errorNode);
  }
}

export function SourceLocation(source, locInfo) {
  this.source = source;
  this.start = {
    line: locInfo.first_line,
    column: locInfo.first_column
  };
  this.end = {
    line: locInfo.last_line,
    column: locInfo.last_column
  };
}

export function id(token) {
  if (/^\[.*\]$/.test(token)) {
    return token.substr(1, token.length - 2);
  } else {
    return token;
  }
}

export function stripFlags(open, close) {
  return {
    open: open.charAt(2) === '~',
    close: close.charAt(close.length - 3) === '~'
  };
}

export function stripComment(comment) {
  return comment.replace(/^\{\{~?\!-?-?/, '')
                .replace(/-?-?~?\}\}$/, '');
}

export function preparePath(data, parts, loc) {
  loc = this.locInfo(loc);

  let original = data ? '@' : '',
      dig = [],
      depth = 0,
      depthString = '';

  for (let i = 0, l = parts.length; i < l; i++) {
    let part = parts[i].part,
        // If we have [] syntax then we do not treat path references as operators,
        // i.e. foo.[this] resolves to approximately context.foo['this']
        isLiteral = parts[i].original !== part;
    original += (parts[i].separator || '') + part;

    if (!isLiteral && (part === '..' || part === '.' || part === 'this')) {
      if (dig.length > 0) {
        throw new Exception('Invalid path: ' + original, {loc});
      } else if (part === '..') {
        depth++;
        depthString += '../';
      }
    } else {
      dig.push(part);
    }
  }

  return {
    type: 'PathExpression',
    data,
    depth,
    parts: dig,
    original,
    loc
  };
}

export function prepareMustache(path, params, hash, open, strip, locInfo) {
  // Must use charAt to support IE pre-10
  let escapeFlag = open.charAt(3) || open.charAt(2),
      escaped = escapeFlag !== '{' && escapeFlag !== '&';

  let decorator = (/\*/.test(open));
  return {
    type: decorator ? 'Decorator' : 'MustacheStatement',
    path,
    params,
    hash,
    escaped,
    strip,
    loc: this.locInfo(locInfo)
  };
}

export function prepareRawBlock(openRawBlock, contents, close, locInfo) {
  validateClose(openRawBlock, close);

  locInfo = this.locInfo(locInfo);
  let program = {
    type: 'Program',
    body: contents,
    strip: {},
    loc: locInfo
  };

  return {
    type: 'BlockStatement',
    path: openRawBlock.path,
    params: openRawBlock.params,
    hash: openRawBlock.hash,
    program,
    openStrip: {},
    inverseStrip: {},
    closeStrip: {},
    loc: locInfo
  };
}

export function prepareNamedBlockSlot(/* openBlock, program, inverseAndProgram, close, inverted, locInfo */) {
  const preparedBlock = prepareBlock.call(this, ...arguments);

  preparedBlock.type = 'NamedBlockSlotStatement';
  // the slot path for a named block slot is just its path
  preparedBlock.slotName = preparedBlock.path.original;
  preparedBlock.params = [];
  preparedBlock.hash = null;

  return preparedBlock;
}

export function prepareBlock(openBlock, program, inverseAndProgram, close, inverted, locInfo) {
  // BEGIN: MODIFICATIONS FOR NAMED BLOCK SLOT POLYFILL
  let inverse,
    inverseStrip,
    type;

  let decorator = (/\*/.test(openBlock.open));
  let slotName = '';

  if (decorator) {
    type = 'DecoratorBlock';
  } else {
    type = 'BlockStatement';

    const originalOpenPath = openBlock.path.original;
    // if the block path has a `::<slot-name>` section the parser will complain, so handle it
    if (originalOpenPath.indexOf('::') > 0) {
      const originalPathExplode = originalOpenPath.split('::');
      const pathParts = openBlock.path.parts;
      const pathPartsLen = pathParts.length;
      const pathPartsLast = pathParts[pathPartsLen - 1];
      // strip out `::<slot-name>` section from block name so we have valid matching paths
      openBlock.path.original = originalPathExplode[0];
      slotName = originalPathExplode[1];
      // make sure to strip out `::<slot-name>` from path parts as well
      openBlock.path.parts[pathPartsLen - 1] = pathPartsLast.split('::')[0];
    }
  }

  if (inverseAndProgram) {
    if (decorator) {
      throw new Exception('Unexpected inverse block on decorator', inverseAndProgram);
    } else if (!slotName) {
      const hasNamedBlockSlots = (
        inverseAndProgram.chain &&
        inverseAndProgram.program.body[0].type === 'NamedBlockSlotStatement'
      );

      if (hasNamedBlockSlots) {
        // wrap in pipes so that we can tell this wasn't a user-generated
        // slot name as if it were it would throw a parse error
        slotName = '|anonymous|';
      }
    }

    if (inverseAndProgram.chain) {
      inverseAndProgram.program.body[0].closeStrip = close.strip;
    }

    inverseStrip = inverseAndProgram.strip;
    inverse = inverseAndProgram.program;
  }
  // END: MODIFICATIONS FOR NAMED BLOCK SLOT POLYFILL

  if (close && close.path) {
    validateClose(openBlock, close);
  }

  program.blockParams = openBlock.blockParams;

  if (inverted) {
    inverted = inverse;
    inverse = program;
    program = inverted;
  }

  return {
    // BEGIN: MODIFICATIONS FOR NAMED BLOCK SLOT POLYFILL
    type,
    path: openBlock.path,
    // for a block with a `::<slot-name>` section, this is just <slot-name>
    // for block with no declared slot name, this will be `|anonymous|`
    // for a decorator block it will simply be empty string
    slotName,
    // END: MODIFICATIONS FOR NAMED BLOCK SLOT POLYFILL
    params: openBlock.params,
    hash: openBlock.hash,
    program,
    inverse,
    openStrip: openBlock.strip,
    inverseStrip,
    closeStrip: close && close.strip,
    loc: this.locInfo(locInfo)
  };
}

export function prepareProgram(statements, loc) {
  if (!loc && statements.length) {
    const firstLoc = statements[0].loc,
          lastLoc = statements[statements.length - 1].loc;

    /* istanbul ignore else */
    if (firstLoc && lastLoc) {
      loc = {
        source: firstLoc.source,
        start: {
          line: firstLoc.start.line,
          column: firstLoc.start.column
        },
        end: {
          line: lastLoc.end.line,
          column: lastLoc.end.column
        }
      };
    }
  }

  return {
    type: 'Program',
    body: statements,
    strip: {},
    loc: loc
  };
}


export function preparePartialBlock(open, program, close, locInfo) {
  validateClose(open, close);

  return {
    type: 'PartialBlockStatement',
    name: open.path,
    params: open.params,
    hash: open.hash,
    program,
    openStrip: open.strip,
    closeStrip: close && close.strip,
    loc: this.locInfo(locInfo)
  };
}
