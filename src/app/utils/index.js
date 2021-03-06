const stringToSlug = str => {
    str = str.replace(/^\s+|\s+$/g, ""); // trim
    str = str.toLowerCase();

    // remove accents, swap ñ for n, etc
    var from = "àáäâèéëêìíïîòóöôùúüûñç·/_,:;";
    var to   = "aaaaeeeeiiiioooouuuunc------";

    for (var i = 0, l = from.length; i < l ; i++) {
        str = str.replace(new RegExp(from.charAt(i), "g"), to.charAt(i));
    }

    str = str.replace(/[^a-z0-9 -]/g, "") // remove invalid chars
        .replace(/\s+/g, "-") // collapse whitespace and replace by -
        .replace(/-+/g, "-"); // collapse dashes

    return str;
};

const transformJSDateToSqlFormat = date => date
    .toISOString().slice(0, 19).replace("T", " ");

const getUtcUnixTimeNow = () => {
    const now = new Date();
    const nowUtc = new Date(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        now.getUTCMinutes(),
        now.getUTCSeconds()
    );
    const nowUtcUnix = nowUtc.getTime() / 1000;

    return nowUtcUnix;
};

module.exports = {
    getUtcUnixTimeNow,
    stringToSlug,
    transformJSDateToSqlFormat
};
