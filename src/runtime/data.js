/**
 * Copyright (c) Baidu Inc. All rights reserved.
 *
 * This source code is licensed under the MIT license.
 * See LICENSE file in the project root for license information.
 *
 * @file 数据类
 */

var ExprType = require('../parser/expr-type');
var evalExpr = require('./eval-expr');
var DataChangeType = require('./data-change-type');
var parseExpr = require('../parser/parse-expr');

/**
 * 数据类
 *
 * @class
 * @param {Object?} data 初始数据
 * @param {Model?} parent 父级数据容器
 */
function Data(data, parent) {
    this.parent = parent;
    this.raw = data || {};
    this.listeners = [];
}

// #[begin] error
// 以下两个函数只在开发模式下可用，在生产模式下不存在
/**
 * DataTypes 检测
 */
Data.prototype.checkDataTypes = function () {
    if (this.typeChecker) {
        this.typeChecker(this.raw);
    }
};

/**
 * 设置 type checker
 *
 * @param  {Function} typeChecker 类型校验器
 */
Data.prototype.setTypeChecker = function (typeChecker) {
    this.typeChecker = typeChecker;
};

// #[end]

/**
 * 添加数据变更的事件监听器
 *
 * @param {Function} listener 监听函数
 */
Data.prototype.listen = function (listener) {
    if (typeof listener === 'function') {
        this.listeners.push(listener);
    }
};

/**
 * 移除数据变更的事件监听器
 *
 * @param {Function} listener 监听函数
 */
Data.prototype.unlisten = function (listener) {
    var len = this.listeners.length;
    while (len--) {
        if (!listener || this.listeners[len] === listener) {
            this.listeners.splice(len, 1);
        }
    }
};

/**
 * 触发数据变更
 *
 * @param {Object} change 变更信息对象
 */
Data.prototype.fire = function (change) {
    if (change.option.silent || change.option.silence || change.option.quiet) {
        return;
    }

    for (var i = 0; i < this.listeners.length; i++) {
        this.listeners[i].call(this, change);
    }
};

/**
 * 获取数据项
 *
 * @param {string|Object?} expr 数据项路径
 * @param {Data?} callee 当前数据获取的调用环境
 * @return {*}
 */
Data.prototype.get = function (expr, callee) {
    var value = this.raw;
    if (!expr) {
        return value;
    }

    if (typeof expr !== 'object') {
        expr = parseExpr(expr);
    }

    var paths = expr.paths;
    callee = callee || this;

    value = value[paths[0].value];

    if (typeof value == 'undefined' && this.parent) {
        value = this.parent.get(expr, callee);
    }
    else {
        for (var i = 1, l = paths.length; value != null && i < l; i++) {
            value = value[paths[i].value || evalExpr(paths[i], callee)];
        }
    }

    return value;
};


/**
 * 数据对象变更操作
 *
 * @inner
 * @param {Object|Array} source 要变更的源数据
 * @param {Array} exprPaths 属性路径
 * @param {number} pathsStart 当前处理的属性路径指针位置
 * @param {number} pathsLen 属性路径长度
 * @param {*} value 变更属性值
 * @param {Data} data 对应的Data对象
 * @return {*} 变更后的新数据
 */
function immutableSet(source, exprPaths, pathsStart, pathsLen, value, data) {
    if (pathsStart >= pathsLen) {
        return value;
    }

    if (source == null) {
        source = {};
    }

    var pathExpr = exprPaths[pathsStart];
    var prop = evalExpr(pathExpr, data);
    var result = source;

    if (source instanceof Array) {
        var index = +prop;
        prop = isNaN(index) ? prop : index;

        result = source.slice(0);
        result[prop] = immutableSet(source[prop], exprPaths, pathsStart + 1, pathsLen, value, data);
    }
    else if (typeof source === 'object') {
        result = {};

        for (var key in source) {
            /* istanbul ignore else  */
            if (key !== prop && source.hasOwnProperty(key)) {
                result[key] = source[key];
            }
        }

        result[prop] = immutableSet(source[prop], exprPaths, pathsStart + 1, pathsLen, value, data);
    }

    if (pathExpr.value == null) {
        exprPaths[pathsStart] = {
            type: typeof prop === 'string' ? ExprType.STRING : ExprType.NUMBER,
            value: prop
        };
    }

    return result;
}

/**
 * 设置数据项
 *
 * @param {string|Object} expr 数据项路径
 * @param {*} value 数据值
 * @param {Object=} option 设置参数
 * @param {boolean} option.silent 静默设置，不触发变更事件
 */
Data.prototype.set = function (expr, value, option) {
    option = option || {};

    // #[begin] error
    var exprRaw = expr;
    // #[end]

    expr = parseExpr(expr);

    // #[begin] error
    if (expr.type !== ExprType.ACCESSOR) {
        throw new Error('[SAN ERROR] Invalid Expression in Data set: ' + exprRaw);
    }
    // #[end]

    if (this.get(expr) === value && !option.force) {
        return;
    }

    expr = {
        type: ExprType.ACCESSOR,
        paths: expr.paths.slice(0)
    };

    var prop = expr.paths[0].value;
    this.raw[prop] = immutableSet(this.raw[prop], expr.paths, 1, expr.paths.length, value, this);

    this.fire({
        type: DataChangeType.SET,
        expr: expr,
        value: value,
        option: option
    });

    // #[begin] error
    this.checkDataTypes();
    // #[end]

};

/**
 * 批量设置数据
 *
 * @param {Object} source 待设置的数据集
 * @param {Object=} option 设置参数
 * @param {boolean} option.silent 静默设置，不触发变更事件
 */
Data.prototype.assign = function (source, option) {
    option = option || {};

    for (var key in source) { // eslint-disable-line
        this.set(
            {
                type: ExprType.ACCESSOR,
                paths: [
                    {type: ExprType.STRING, value: key}
                ]
            },
            source[key],
            option
        );
    }
};

/**
 * 合并更新数据项
 *
 * @param {string|Object} expr 数据项路径
 * @param {Object} source 待合并的数据
 * @param {Object=} option 设置参数
 * @param {boolean} option.silent 静默设置，不触发变更事件
 */
Data.prototype.merge = function (expr, source, option) {
    option = option || {};

    // #[begin] error
    var exprRaw = expr;
    // #[end]

    expr = parseExpr(expr);

    // #[begin] error
    if (expr.type !== ExprType.ACCESSOR) {
        throw new Error('[SAN ERROR] Invalid Expression in Data merge: ' + exprRaw);
    }

    if (typeof this.get(expr) !== 'object') {
        throw new Error('[SAN ERROR] Merge Expects a Target of Type \'object\'; got ' + typeof oldValue);
    }

    if (typeof source !== 'object') {
        throw new Error('[SAN ERROR] Merge Expects a Source of Type \'object\'; got ' + typeof source);
    }
    // #[end]

    for (var key in source) { // eslint-disable-line
        this.set(
            {
                type: ExprType.ACCESSOR,
                paths: expr.paths.concat(
                    [
                        {
                            type: ExprType.STRING,
                            value: key
                        }
                    ]
                )
            },
            source[key],
            option
        );
    }
};

/**
 * 基于更新函数更新数据项
 *
 * @param {string|Object} expr 数据项路径
 * @param {Function} fn 数据处理函数
 * @param {Object=} option 设置参数
 * @param {boolean} option.silent 静默设置，不触发变更事件
 */
Data.prototype.apply = function (expr, fn, option) {
    // #[begin] error
    var exprRaw = expr;
    // #[end]

    expr = parseExpr(expr);

    // #[begin] error
    if (expr.type !== ExprType.ACCESSOR) {
        throw new Error('[SAN ERROR] Invalid Expression in Data apply: ' + exprRaw);
    }
    // #[end]

    var oldValue = this.get(expr);

    // #[begin] error
    if (typeof fn !== 'function') {
        throw new Error(
            '[SAN ERROR] Invalid Argument\'s Type in Data apply: '
            + 'Expected Function but got ' + typeof fn
        );
    }
    // #[end]

    this.set(expr, fn(oldValue), option);
};

/**
 * 数组数据项splice操作
 *
 * @param {string|Object} expr 数据项路径
 * @param {Array} args splice 接受的参数列表，数组项与Array.prototype.splice的参数一致
 * @param {Object=} option 设置参数
 * @param {boolean} option.silent 静默设置，不触发变更事件
 * @return {Array} 新数组
 */
Data.prototype.splice = function (expr, args, option) {
    option = option || {};
    // #[begin] error
    var exprRaw = expr;
    // #[end]

    expr = parseExpr(expr);

    // #[begin] error
    if (expr.type !== ExprType.ACCESSOR) {
        throw new Error('[SAN ERROR] Invalid Expression in Data splice: ' + exprRaw);
    }
    // #[end]

    expr = {
        type: ExprType.ACCESSOR,
        paths: expr.paths.slice(0)
    };

    var target = this.get(expr);
    var returnValue = [];

    if (target instanceof Array) {
        var index = args[0];
        var len = target.length;
        if (index > len) {
            index = len;
        }
        else if (index < 0) {
            index = len + index;
            if (index < 0) {
                index = 0;
            }
        }

        var newArray = target.slice(0);
        returnValue = newArray.splice.apply(newArray, args);

        this.raw = immutableSet(this.raw, expr.paths, 0, expr.paths.length, newArray, this);

        this.fire({
            expr: expr,
            type: DataChangeType.SPLICE,
            index: index,
            deleteCount: returnValue.length,
            value: returnValue,
            insertions: args.slice(2),
            option: option
        });
    }

    // #[begin] error
    this.checkDataTypes();
    // #[end]

    return returnValue;
};

/**
 * 数组数据项push操作
 *
 * @param {string|Object} expr 数据项路径
 * @param {*} item 要push的值
 * @param {Object=} option 设置参数
 * @param {boolean} option.silent 静默设置，不触发变更事件
 * @return {number} 新数组的length属性
 */
Data.prototype.push = function (expr, item, option) {
    var target = this.get(expr);

    if (target instanceof Array) {
        this.splice(expr, [target.length, 0, item], option);
        return target.length + 1;
    }
};

/**
 * 数组数据项pop操作
 *
 * @param {string|Object} expr 数据项路径
 * @param {Object=} option 设置参数
 * @param {boolean} option.silent 静默设置，不触发变更事件
 * @return {*}
 */
Data.prototype.pop = function (expr, option) {
    var target = this.get(expr);

    if (target instanceof Array) {
        var len = target.length;
        if (len) {
            return this.splice(expr, [len - 1, 1], option)[0];
        }
    }
};

/**
 * 数组数据项shift操作
 *
 * @param {string|Object} expr 数据项路径
 * @param {Object=} option 设置参数
 * @param {boolean} option.silent 静默设置，不触发变更事件
 * @return {*}
 */
Data.prototype.shift = function (expr, option) {
    return this.splice(expr, [0, 1], option)[0];
};

/**
 * 数组数据项unshift操作
 *
 * @param {string|Object} expr 数据项路径
 * @param {*} item 要unshift的值
 * @param {Object=} option 设置参数
 * @param {boolean} option.silent 静默设置，不触发变更事件
 * @return {number} 新数组的length属性
 */
Data.prototype.unshift = function (expr, item, option) {
    var target = this.get(expr);

    if (target instanceof Array) {
        this.splice(expr, [0, 0, item], option);
        return target.length + 1;
    }
};

/**
 * 数组数据项移除操作
 *
 * @param {string|Object} expr 数据项路径
 * @param {number} index 要移除项的索引
 * @param {Object=} option 设置参数
 * @param {boolean} option.silent 静默设置，不触发变更事件
 */
Data.prototype.removeAt = function (expr, index, option) {
    this.splice(expr, [index, 1], option);
};

/**
 * 数组数据项移除操作
 *
 * @param {string|Object} expr 数据项路径
 * @param {*} value 要移除的项
 * @param {Object=} option 设置参数
 * @param {boolean} option.silent 静默设置，不触发变更事件
 */
Data.prototype.remove = function (expr, value, option) {
    var target = this.get(expr);

    if (target instanceof Array) {
        var len = target.length;
        while (len--) {
            if (target[len] === value) {
                this.splice(expr, [len, 1], option);
                break;
            }
        }
    }
};

exports = module.exports = Data;
