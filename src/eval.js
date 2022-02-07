const acorn = require('acorn');
const Scope = require('./scope')
const BlockInterruption = require('./interrupt')
let srcCode = ''
/**
 * 
 * @param {Node} node AST节点
 * @param {Scope} scope 当前作用域 Scope
 * @param {JSON} config 配置项（label,isSetObj）
 * @author: kumlowhup
 * @date : 2022-2-2 
 * @returns node为js表达式时返回运算结果
 */
function evaluate(node, scope, config) {
  if (!node) return
  switch (node.type) {
    case 'Program': {
      let arr = node.body.map(n => evaluate.call(this, n, scope))
      return arr.length ? arr[arr.length - 1] : undefined
    }
    case 'Literal':
      return node.value;
    case 'Identifier': {
      return scope.get(node.name);
    }
    case 'ExpressionStatement': {
      return evaluate.call(this, node.expression, scope)
    }
    /**
     * 
      enum AssignmentOperator {
        "=" | "+=" | "-=" | "*=" | "/=" | "%="
            | "<<=" | ">>=" | ">>>="
            | "|=" | "^=" | "&="
      }
     */
    case 'AssignmentExpression': {
      let rightValue = evaluate.call(this, node.right, scope)
      if (node.left.type === 'Identifier') {
        // 直接给变量赋值
        let leftValue = evaluate.call(this, node.left, scope)
        switch (node.operator) {
          case '=': scope.set(node.left.name, rightValue); break;
          case '+=': scope.set(node.left.name, leftValue + rightValue); break;
          case '-=': scope.set(node.left.name, leftValue - rightValue); break;
          case '/=': scope.set(node.left.name, leftValue / rightValue); break;
          case '*=': scope.set(node.left.name, leftValue * rightValue); break;
          case '%=': scope.set(node.left.name, leftValue % rightValue); break;
          case '<<=': scope.set(node.left.name, leftValue << rightValue); break;
          case '>>=': scope.set(node.left.name, leftValue >> rightValue); break;
          case '>>>=': scope.set(node.left.name, leftValue >>> rightValue); break;
          case '|=': scope.set(node.left.name, leftValue | rightValue); break;
          case '^=': scope.set(node.left.name, leftValue ^ rightValue); break;
          case '&=': scope.set(node.left.name, leftValue & rightValue); break;
        }
        return scope.get(node.left.name)
      } else if (node.left.type === 'MemberExpression') {
        // 给对象的内部属性赋值
        let [leftObj, leftPropName] = evaluate.call(this, node.left, scope, { setObjPropVal: true })
        let leftValue = leftObj[leftPropName]
        let retVal;
        switch (node.operator) {
          case '=': retVal = rightValue; break;
          case '+=': retVal = leftValue + rightValue; break;
          case '-=': retVal = leftValue - rightValue; break;
          case '/=': retVal = leftValue / rightValue; break;
          case '*=': retVal = leftValue * rightValue; break;
          case '%=': retVal = leftValue % rightValue; break;
          case '<<=': retVal = leftValue << rightValue; break;
          case '>>=': retVal = leftValue >> rightValue; break;
          case '>>>=': retVal = leftValue >>> rightValue; break;
          case '|=': retVal = leftValue | rightValue; break;
          case '^=': retVal = leftValue ^ rightValue; break;
          case '&=': retVal = leftValue & rightValue; break;
        }
        leftObj[leftPropName] = retVal;
        return retVal;
      }
    }
    case 'BlockStatement': {
      let ret
      for (const expression of node.body) {
        ret = evaluate.call(this, expression, scope)
        if (ret instanceof BlockInterruption) return ret;
      }
      return ret
    }
    case 'FunctionDeclaration': {
      // 命名函数
      return scope.declare('var', node.id.name, function (...args) {
        const nodeScope = new Scope('function', scope)
        node.params.forEach((param, i) => {
          nodeScope.declare('let', param.name, args[i])
        })
        return evaluate.call(this, node.body, nodeScope);
      })
    }
    // 变量声明
    case 'VariableDeclaration': {
      return node.declarations.forEach(v => {
        return scope.declare(node.kind, v.id.name, evaluate.call(this, v.init, scope))
      })
    }
    // If
    case 'IfStatement': {
      if (evaluate.call(this, node.test, scope)) {
        return evaluate.call(this, node.consequent, scope)
      } else if (node.alternate) {
        return evaluate.call(this, node.alternate, scope)
      } else return
    }
    // Switch
    case 'SwitchStatement': {
      let ret
      node.cases.forEach(c => {
        if (c.test !== null && !(evaluate.call(this, c.test, scope) === evaluate.call(this, node.discriminant, scope))) return ret
        c.consequent.forEach(e => {
          if (e.type === 'BlockStatement') {
            ret = evaluate.call(this, e, new Scope('block', scope))
          } else {
            ret = evaluate.call(this, e, scope)
          }
        })
      })
      return ret
    }
    // continue 语句
    case 'ContinueStatement': {
      let continuation = new BlockInterruption('continue');
      if (node.label) continuation.setLabel(node.label.name)
      return continuation
    }
    // break 语句
    case 'BreakStatement': {
      let breaker = new BlockInterruption('break')
      if (node.label) breaker.setLabel(node.label.name)
      return breaker
    }
    // while 语句
    case 'WhileStatement': {
      let ret
      let label = config?.label
      const whileScope = new Scope('block', scope)
      while (evaluate.call(this, node.test, whileScope)) {
        const whileInnerScope = new Scope('block', whileScope)
        ret = evaluate.call(this, node.body, whileInnerScope)
        if (ret instanceof BlockInterruption && ret.getType() === 'continue') {
          if (ret.getLabel() === undefined || ret.getLabel() === label) {
            continue
          }
          else return ret
        }
        if (ret instanceof BlockInterruption && ret.getType() === 'break') {
          if (ret.getLabel() === undefined || ret.getLabel() === label) { return }
          else return ret
        }
        if (ret instanceof BlockInterruption && ret.getType() === 'return') return ret
      }
      return
    }
    // for语句
    case 'ForStatement': {
      let ret
      let label = config?.label
      // 包括定义索引等的定义域
      const forScope = new Scope('block', scope)
      for (evaluate.call(this, node.init, forScope); evaluate.call(this, node.test, forScope); evaluate.call(this, node.update, forScope)) {
        // 每次循环内产生内作用域
        const forInnerScope = new Scope('block', forScope)
        // 运行while内代码
        ret = evaluate.call(this, node.body, forInnerScope)
        // continue
        if (ret instanceof BlockInterruption && ret.getType() === 'continue') {
          // 无label或指定当前label 跳过当前while本次循环
          if (ret.getLabel() === undefined || ret.getLabel() === label) { continue }
          // label不匹配 向上一级作用域抛
          else return ret
        }
        // break
        if (ret instanceof BlockInterruption && ret.getType() === 'break') {
          if (ret.getLabel() === undefined || ret.getLabel() === label) { return }
          else return ret
        }
        // return
        if (ret instanceof BlockInterruption && ret.getType() === 'return') return ret
      }
      return
    }
    case 'DoWhileStatement': {
      let ret
      let label = config?.label
      const whileScope = new Scope('block', scope)
      do {
        const whileInnerScope = new Scope('block', whileScope)
        ret = evaluate.call(this, node.body, whileInnerScope)
        if (ret instanceof BlockInterruption && ret.getType() === 'continue') {
          if (ret.getLabel() === undefined || ret.getLabel() === label) {
            continue
          }
          else return ret
        }
        if (ret instanceof BlockInterruption && ret.getType() === 'break') {
          if (ret.getLabel() === undefined || ret.getLabel() === label) { return }
          else return ret
        }
        if (ret instanceof BlockInterruption && ret.getType() === 'return') return ret
      } while (evaluate.call(this, node.test, whileScope))
      return
    }
    case 'ForInStatement': {
      let ret
      let label = config?.label
      for (const e in evaluate.call(this, node.right, scope)) {
        // 每次循环内产生内作用域
        const forInScope = new Scope('block', scope)
        forInScope.declare(node.left.kind, node.left.declarations[0].id.name, e)
        ret = evaluate.call(this, node.body, forInScope)
        // continue
        if (ret instanceof BlockInterruption && ret.getType() === 'continue') {
          // 无label或指定当前label 跳过当前while本次循环
          if (ret.getLabel() === undefined || ret.getLabel() === label) { continue }
          // label不匹配 向上一级作用域抛
          else return ret
        }
        // break
        if (ret instanceof BlockInterruption && ret.getType() === 'break') {
          if (ret.getLabel() === undefined || ret.getLabel() === label) { return }
          else return ret
        }
        // return
        if (ret instanceof BlockInterruption && ret.getType() === 'return') return ret
      }
      return
    }
    case 'LabeledStatement': {
      return evaluate.call(this, node.body, scope, {
        label: node.label.name
      })
    }
    // 逻辑运算符
    case 'LogicalExpression': {
      switch (node.operator) {
        case '&&': return evaluate.call(this, node.left, scope) && evaluate.call(this, node.right, scope)
        case '||': return evaluate.call(this, node.left, scope) || evaluate.call(this, node.right, scope)
      }
    }
    // 基本运算符
    /**
     * 
      enum BinaryOperator {
            "==" | "!=" | "===" | "!=="
          | "<" | "<=" | ">" | ">="
          | "<<" | ">>" | ">>>"
          | "+" | "-" | "*" | "/" | "%"
          | "|" | "^" | "&" | "in"
          | "instanceof"
          }
     */
    case 'BinaryExpression': {
      const left = evaluate.call(this, node.left, scope)
      const right = evaluate.call(this, node.right, scope)
      switch (node.operator) {
        case '==': return left == right
        case '!=': return left != right
        case '===': return left === right
        case '!==': return left !== right
        case '<': return left < right;
        case '<=': return left <= right
        case '>': return left > right
        case '>=': return left >= right
        case '<<': return left << right
        case '>>': return left >> right
        case '>>>': return left >>> right
        case '+': return left + right
        case '-': return left - right
        case '*': return left * right
        case '/': return left / right
        case '%': return left % right
        case '|': return left | right
        case '^': return left ^ right
        case '&': return left & right
        case 'in': return left in right
        case 'instanceof': return left instanceof right
      }
    }
    // enum UnaryOperator {"-" | "+" | "!" | "~" | "typeof" | "void" | "delete"}
    case 'UnaryExpression': {
      switch (node.operator) {
        case '-': return -evaluate.call(this, node.argument, scope)
        case '+': return +evaluate.call(this, node.argument, scope)
        case '!': return !evaluate.call(this, node.argument, scope)
        case '~': return ~evaluate.call(this, node.argument, scope)
        case 'typeof': return typeof evaluate.call(this, node.argument, scope)
      }
    }
    // ++ 和 --
    case 'UpdateExpression': {
      let preValue = evaluate.call(this, node.argument, scope)
      if (node.argument.type === 'MemberExpression') {
        let [obj, objPropName] = evaluate.call(this, node.argument, scope, { setObjPropVal: true })
        if (node.operator === '++') {
          return node.prefix ? ++obj[objPropName] : obj[objPropName]++
        } else {
          return node.prefix ? --obj[objPropName] : obj[objPropName]--
        }
      } else {
        // node.argument.type === 'Indentifier'
        if (node.operator === '++') {
          scope.set(node.argument.name, preValue + 1)
          return node.prefix ? (preValue + 1) : preValue
        } else {
          scope.set(node.argument.name, preValue - 1)
          return node.prefix ? (preValue - 1) : preValue
        }
      }
    }
    // 三目运算符
    case 'ConditionalExpression':
      return evaluate.call(this, node.test, scope) ? evaluate.call(this, node.consequent, scope) : evaluate.call(this, node.alternate, scope)
    //对象
    case 'ObjectExpression':
      {
        let props = node.properties
        const obj = {}
        props.forEach(p => {
          obj[p.key.name] = evaluate.call(this, p.value, scope)
        });
        return obj
      }
    case 'MemberExpression': {
      // 是否设置属性内部值
      let isSetObjPropVal = config?.setObjPropVal
      let obj = node.object.name ? scope.get(node.object.name) : evaluate.call(this, node.object, scope)
      let pname = node.computed ? evaluate.call(this, node.property, scope) : node.property.name
      let propValue = obj[pname]
      if (propValue instanceof BlockInterruption) propValue = propValue.value
      return isSetObjPropVal ? [obj, pname] : propValue
    }
    // 数组
    case 'ArrayExpression': {
      return node.elements.map(e => evaluate.call(this, e, scope)) || []
    }
    // 调用执行函数
    case 'CallExpression': {
      // console.log('call 处 this', this.toString())
      let getFun = evaluate.call(this, node.callee, scope, { setObjPropVal: true })
      let ret
      if (getFun instanceof Array) {
        let [o, p] = getFun;
        let f = o[p]
        if (!(f instanceof Function)) {
          let functionName = srcCode.substring(node.callee.start, node.callee.end)
          throw new TypeError(`${functionName}is not a function`)
        }
        ret = f.apply(o, node.arguments.map(arg => evaluate.call(this, arg, scope)))
      } else {
        if (!getFun instanceof Function) {
          let functionName = srcCode.substring(node.callee.start, node.callee.end)
          throw new TypeError(`${functionName}is not a function`)
        }
        ret = getFun.apply(this, node.arguments.map(arg => evaluate.call(this, arg, scope)))
      }
      // ret = fun(...node.arguments.map(arg => evaluate.call(this, arg, scope)));
      return ret instanceof BlockInterruption ? ret.value : ret
    }
    // 普通函数
    case 'FunctionExpression': {
      let fun = function (...args) {
        const funScope = new Scope('function', scope)
        node.params.forEach((param, i) => {
          funScope.declare('let', param.name, args[i])
        })
        return evaluate.call(this, node.body, funScope);
      }
      if (node.id !== null) {
        scope.declare('var', node.id.name, fun)
      }
      fun.toString = () => srcCode.substring(node.start, node.end)
      return fun
    }
    // 箭头函数
    case 'ArrowFunctionExpression': {
      const fun = (...args) => {
        const funScope = new Scope('function', scope)
        node.params.forEach((param, i) => {
          funScope.declare('let', param.name, args[i])
        })
        return evaluate.call(this, node.body, funScope);
      }
      fun.toString = () => srcCode.substring(node.start, node.end)
      return fun
    }
    // try
    case 'TryStatement': {
      try {
        const tryScope = new Scope('block', scope)
        evaluate.call(this, node.block, tryScope)
      } catch (err) {
        const catchScope = new Scope('block', scope)
        catchScope.declare('let', node.handler.param.name, err)
        return evaluate.call(this, node.handler.body, catchScope)
      } finally {
        const finallyScope = new Scope('block', scope)
        evaluate.call(this, node.finalizer, finallyScope)
      }
    }
    // throw
    case 'ThrowStatement': {
      throw evaluate.call(this, node.argument, scope)
    }
    case 'EmptyStatement': return
    case 'SequenceExpression': {
      let arr = node.expressions.map(e => evaluate.call(this, e, scope))
      return arr[arr.length - 1]
    }
    // return
    case 'ReturnStatement': {
      return new BlockInterruption('return', evaluate.call(this, node.argument, scope))
    }
    // new 构造函数
    case 'NewExpression': {
      const callee = evaluate.call(this, node.callee, scope)

      if (callee.prototype === undefined) {
        let funName;
        node.callee
        throw new TypeError(`${srcCode.substring(node.callee.start, node.callee.end)} is not a constructor`)
      }
      const args = node.arguments.map(arg => evaluate.call(this, arg, scope))
      const o = Object.create(callee.prototype)
      o.toString = () => { return `[object ${node.callee.name}]` }
      let k = callee.apply(o, args)
      if (k instanceof BlockInterruption) {
        return k.value instanceof Object ? k.value : o
      } else {
        return o
      }
    }
    case 'ThisExpression': {
      return this
    }
  }
  console.log(node)
  throw new Error(`Unsupported Syntax ${node.type} at Location ${node.start}:${node.end}`);
}

function customerEval(code, env = new Scope('block')) {
  srcCode = code
  const node = acorn.parse(code, {
    ecmaVersion: 6
  })
  return evaluate(node, env)
}

module.exports = customerEval