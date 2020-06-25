'use strict';

const Service = require('egg').Service;
const moment = require('moment');
const Hash = require('../utils/hash');

const keys = require('../../config/keys');
const axios = require('../utils/axios');

const BASE_URL = 'https://app-api.pixiv.net';
const CLIENT_ID = 'MOBrBDS8blbauoSck0ZfDbtuzpyT';
const CLIENT_SECRET = 'lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj';
const HASH_SECRET = '28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c';
const HEADERS = {
    'App-OS': 'ios',
    'Accept-Language': 'en-us',
    'App-OS-Version': '12.2',
    'App-Version': '7.6.2',
    'User-Agent': 'PixivIOSApp/7.6.2 (iOS 12.2; iPhone8,2)',
};
const filter = 'for_ios';

const DATA_CACHE_TIME = 1800;

class PixivService extends Service {
    async getHeaders() {
        if (!this.ctx.app.auth) {
            await this.login();
        }
        return {
            ...HEADERS,
            Authorization: `Bearer ${this.ctx.app.auth.access_token}`,
        };
    }
    getSecretHeaders() {
        const datetime = moment().format();
        return {
            ...HEADERS,
            'X-Client-Time': datetime,
            'X-Client-Hash': Hash.md5(`${datetime}${HASH_SECRET}`),
        };
    }
    async generalRequest(url, data) {
        return axios.get(BASE_URL + url, {
            headers: await this.getHeaders(),
            params: data,
        });
    }
    setAuth(auth) {
        this.ctx.app.auth = auth;
    }
    async login() {
        const auth_cached = await this.service.redis.get('pixivc_auth');
        if (auth_cached) {
            this.setAuth(auth_cached);
            return;
        }
        try {
            const res = await axios.post(
                'https://oauth.secure.pixiv.net/auth/token',
                {
                    client_id: CLIENT_ID,
                    client_secret: CLIENT_SECRET,
                    get_secure_url: true,
                    include_policy: true,
                    grant_type: 'password',
                    username: keys.pixiv_username,
                    password: keys.pixiv_password,
                },
                {
                    headers: this.getSecretHeaders(),
                }
            );
            if (res.data && res.data.response) {
                const auth = res.data.response;
                this.service.redis.set('pixivc_auth', JSON.stringify(auth), auth.expires_in);
                this.setAuth(auth);
            } else {
                throw 'Cannot login.';
            }
        } catch (err) {
            throw err.message;
        }
    }
    async refreshToken() {
        if (!this.ctx.app.auth) {
            await this.login();
            return;
        }
        try {
            const res = await axios.post('https://oauth.secure.pixiv.net/auth/token', {
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                get_secure_url: true,
                include_policy: true,
                grant_type: 'refresh_token',
                refresh_token: this.ctx.app.auth.refresh_token,
            }, {
                headers: this.getSecretHeaders(),
            });
            if (res.data && res.data.response) {
                const auth = res.data.response;
                this.service.redis.set('pixivc_auth', JSON.stringify(auth), auth.expires_in);
                this.setAuth(auth);
            } else {
                throw 'Cannot refresh token.';
            }
        } catch (err) {
            throw err.message;
        }
    }
    // 插画详情
    async illustDetail(id) {
        const detail = await this.service.redis.get(`pixivc_illust_detail_${id}`);
        if (detail) {
            return detail;
        }
        const res = await this.generalRequest('/v1/illust/detail', {
            illust_id: id,
            filter,
        });
        if (res.data) {
            this.service.redis.set(`pixivc_illust_detail_${id}`, res.data, DATA_CACHE_TIME);
            return res.data;
        }
        return null;
    }
}

module.exports = PixivService;
