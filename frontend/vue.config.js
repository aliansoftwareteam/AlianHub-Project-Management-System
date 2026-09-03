const { defineConfig } = require('@vue/cli-service');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');
const brandSettings = require('../brandSettings.json');
const imageURL = `/api/v1/getlogo?key=logo&type=web`;

module.exports = defineConfig({
  transpileDependencies: true,
  devServer: {
    proxy: {
      '^/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      // Server-rendered public share pages (GET /share/:token and its intake
      // form POST) live on the backend, same as /api.
      '^/share': {
        target: 'http://localhost:4000',
        changeOrigin: true
      },
      'socket.io': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  },
  configureWebpack: {
    resolve: {
      alias: {
        '@pageContent': path.resolve(__dirname, '../Modules/Pages/helpers/pageContent.js'),
      },
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: 'public/index.html',
        filename: 'index.html',
        meta: {
          'og:title': {
            property: 'og:title',
            content: brandSettings?.productName || 'Website',
          },
          'og:description': {
            property: 'og:description',
            content: 'Project Management System'
          },
          'og:image': {
            property: 'og:image',
            content: `${imageURL}`
          },
          'og:image:width': {
            property: 'og:image:width',
            content: '600'
          },
          'og:image:height': {
            property: 'og:image:height',
            content: '315'
          },
          'og:type': {
            property: 'og:type',
            content: 'website'
          },
          'twitter:card': {
            name: 'twitter:card',
            content: 'summary_large_image'
          },
          'twitter:title': {
            name: 'twitter:title',
            content: brandSettings?.productName || 'Website'
          },
          'twitter:description': {
            name: 'twitter:description',
            content: 'Project Management System'
          },
          'twitter:image': {
            name: 'twitter:image',
            content: `${imageURL}`
          },
          'twitter:image:width': {
            name: 'twitter:image:width',
            content: '600'
          },
          'twitter:image:height': {
            name: 'twitter:image:height',
            content: '315'
          },
        }
      })
    ]
  },
  chainWebpack: config => {
    // Remove the default HtmlWebpackPlugin added by Vue CLI
    config.plugins.delete('html');
  }
});
